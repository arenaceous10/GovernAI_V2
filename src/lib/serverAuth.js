// Server-side sign-in check for the API functions (evidence packs, model connector). The caller's Supabase access
// token is checked with Supabase Auth, and every later read uses that same token, so row-level security decides what
// the function can see: a function never reads more than the signed-in person could read themselves.
export async function signedIn(req, { env = process.env, fetchImpl = fetch } = {}) {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return { status: 503, error: 'Sign-in is not configured on the server' };
  const m = String(req.headers?.authorization || req.headers?.Authorization || '').match(/^Bearer\s+([A-Za-z0-9._-]{20,4096})$/);
  if (!m) return { status: 401, error: 'Sign in first' };
  const h = { apikey: anon, Authorization: `Bearer ${m[1]}` };
  const u = await fetchImpl(`${url}/auth/v1/user`, { headers: h });
  if (!u.ok) return { status: 401, error: 'Your session has expired. Sign in again.' };
  const user = await u.json();
  if (!user?.id) return { status: 401, error: 'Sign in first' };
  const p = await fetchImpl(`${url}/rest/v1/v2_profiles?select=role,status,name,client_id&id=eq.${encodeURIComponent(user.id)}`, { headers: h });
  const profile = p.ok ? (await p.json())?.[0] : null;
  if (!profile || profile.status !== 'active') return { status: 403, error: 'Your account is not active' };
  // Reads as this user (row-level security applies). Returns parsed JSON or null.
  const get = async (path) => {
    const r = await fetchImpl(`${url}/rest/v1/${path}`, { headers: h });
    return r.ok ? r.json() : null;
  };
  return { ok: true, user, profile, get };
}

export function readBody(req, max) {
  if (+(req.headers?.['content-length'] || 0) > max) return { error: 'Request too large', status: 413 };
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}; } catch { return { error: 'Invalid JSON', status: 400 }; }
  if (JSON.stringify(body).length > max) return { error: 'Request too large', status: 413 };
  return { body };
}
