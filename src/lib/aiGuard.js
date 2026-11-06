// Who may call the AI endpoint, and how often. Runs on the server (api/generate-questions.js).
// 1. The caller must send a valid Supabase access token (checked with Supabase Auth, not just decoded).
// 2. Their profile must be active, with a role that can register AI products (client or admin).
// 3. Rate limit: each call is recorded in v2_ai_usage with the caller's own token (row-level security ties the
//    row to them, and they cannot delete it). Over the hourly or daily limit, the call is refused.
// Fails closed: if Supabase is not configured on the server, the endpoint refuses every call.

export const LIMITS = { perHour: 12, perDay: 40 };
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

  const p = await fetchImpl(`${url}/rest/v1/v2_profiles?select=role,status&id=eq.${encodeURIComponent(user.id)}`, { headers: h });
  const prof = p.ok ? (await p.json())?.[0] : null;
  if (!prof || prof.status !== 'active' || !['client', 'admin'].includes(prof.role)) return { status: 403, error: 'Your role cannot generate assessment questions' };

  const since = new Date(now - 86400000).toISOString();
  const q = await fetchImpl(`${url}/rest/v1/v2_ai_usage?select=at&user_id=eq.${encodeURIComponent(user.id)}&at=gte.${encodeURIComponent(since)}&order=at.desc&limit=${LIMITS.perDay + 1}`, { headers: h });
  if (!q.ok) return { status: 503, error: 'AI questions are not available right now' };
  const rows = await q.json();
  const hour = rows.filter((r) => new Date(r.at).getTime() > now - 3600000).length;
  if (hour >= LIMITS.perHour || rows.length >= LIMITS.perDay) {
    return { status: 429, error: `AI question limit reached (${LIMITS.perHour} an hour, ${LIMITS.perDay} a day). The standard question picker is used instead.` };
  }
  const ins = await fetchImpl(`${url}/rest/v1/v2_ai_usage`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: '{}' });
  if (!ins.ok) return { status: 503, error: 'AI questions are not available right now' };
  return { ok: true, userId: user.id };
}
