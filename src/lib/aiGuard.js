// Who may call the AI endpoint, and how often. Runs on the server (api/generate-questions.js).
// 1. The caller must send a valid Supabase access token (checked with Supabase Auth, not just decoded).
// 2. Their profile must be active, with a role that can register AI products (client or admin).
// 3. Rate limit: the database function ai_usage_take() checks and records each call in one locked step, per user
//    (hourly and daily) and for the whole workspace (daily). Users cannot write or delete usage rows themselves.
// Fails closed: if Supabase is not configured on the server, the endpoint refuses every call.

export const LIMITS = { perHour: 12, perDay: 40, globalDay: 600 };   // mirrored in supabase/migrations/005
export const MAX_BODY = 24 * 1024; // bytes

export async function guard(req, { env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return { status: 503, error: 'AI questions are not available: sign-in is not configured on the server' };
  const auth = String(req.headers?.authorization || req.headers?.Authorization || '');
  const m = auth.match(/^Bearer\s+([A-Za-z0-9._-]{20,4096})$/);
  if (!m) return { status: 401, error: 'Sign in to use AI questions' };
  const token = m[1];
  const h = { apikey: anon, Authorization: `Bearer ${token}` };

  const u = await fetchImpl(`${url}/auth/v1/user`, { headers: h });
  if (!u.ok) return { status: 401, error: 'Your session has expired. Sign in again.' };
  const user = await u.json();
  if (!user?.id) return { status: 401, error: 'Sign in to use AI questions' };

  const p = await fetchImpl(`${url}/rest/v1/v2_profiles?select=role,status,name,client_id&id=eq.${encodeURIComponent(user.id)}`, { headers: h });
  const prof = p.ok ? (await p.json())?.[0] : null;
  if (!prof || prof.status !== 'active' || !['client', 'admin'].includes(prof.role)) return { status: 403, error: 'Your role cannot generate assessment questions' };

  // Check and record in one locked database step (ai_usage_take), so parallel calls cannot slip past the limit.
  const t = await fetchImpl(`${url}/rest/v1/rpc/ai_usage_take`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' });
  if (!t.ok) return { status: 503, error: 'AI questions are not available right now' };
  const verdict = await t.json();
  if (verdict === 'forbidden') return { status: 403, error: 'Your role cannot generate assessment questions' };
  if (verdict === 'global') return { status: 429, error: 'AI questions have reached today\'s limit for this workspace. The standard question picker is used instead.' };
  if (verdict !== 'ok') return { status: 429, error: `AI question limit reached (${LIMITS.perHour} an hour, ${LIMITS.perDay} a day). The standard question picker is used instead.` };

  // Names the model must never see, known on the server: the caller's own name and organisation.
  const known = [prof.name, ...String(prof.name || '').split(/\s+/).filter((w) => w.length >= 3), user.email?.split('@')[0]];
  if (prof.client_id) {
    const c = await fetchImpl(`${url}/rest/v1/v2_clients?select=name&id=eq.${encodeURIComponent(prof.client_id)}`, { headers: h });
    if (c.ok) known.push(...((await c.json()) || []).map((r) => r.name));
  }
  return { ok: true, userId: user.id, known: known.filter(Boolean) };
}
