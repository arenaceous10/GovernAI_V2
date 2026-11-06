// The AI endpoint's gate: sign-in, role and rate limit, against a stubbed Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { guard, LIMITS } from '../src/lib/aiGuard.js';

const env = { VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' };
const TOKEN = 'eyJ' + 'a'.repeat(40);
function stub({ user = { id: 'u1' }, profile = { role: 'client', status: 'active' }, usage = [], insertOk = true } = {}) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url, opts });
    const json = (v, ok = true) => ({ ok, json: async () => v });
    if (url.endsWith('/auth/v1/user')) return opts.headers.Authorization === `Bearer ${TOKEN}` && user ? json(user) : json({}, false);
    if (url.includes('/v2_profiles')) return json(profile ? [profile] : []);
    if (url.includes('/v2_ai_usage') && opts.method === 'POST') return json(null, insertOk);
    if (url.includes('/v2_ai_usage')) return json(usage);
    return json({}, false);
  };
  f.calls = calls; return f;
}
const req = (auth) => ({ headers: auth ? { authorization: auth } : {} });

test('refuses when Supabase is not configured (fails closed)', async () => {
  assert.equal((await guard(req(`Bearer ${TOKEN}`), { env: {}, fetchImpl: stub() })).status, 503);
});
test('refuses without a valid sign-in token', async () => {
  for (const a of [null, 'Bearer short', 'Basic abc', `Bearer ${'b'.repeat(40)}`]) assert.equal((await guard(req(a), { env, fetchImpl: stub() })).status, 401, String(a));
});
test('refuses pending, disabled and governance-team accounts', async () => {
  for (const profile of [null, { role: 'client', status: 'pending' }, { role: 'client', status: 'disabled' }, { role: 'assessor', status: 'active' }, { role: 'lead', status: 'active' }]) {
    assert.equal((await guard(req(`Bearer ${TOKEN}`), { env, fetchImpl: stub({ profile }) })).status, 403, JSON.stringify(profile));
  }
});
test('allows an active client and records the call', async () => {
  const f = stub();
  const r = await guard(req(`Bearer ${TOKEN}`), { env, fetchImpl: f });
  assert.ok(r.ok);
  assert.ok(f.calls.some((c) => c.opts.method === 'POST' && c.url.endsWith('/v2_ai_usage')));
});
test('rate limits per hour and per day', async () => {
  const now = Date.now();
  const recent = Array.from({ length: LIMITS.perHour }, (_, i) => ({ at: new Date(now - i * 60000).toISOString() }));
  assert.equal((await guard(req(`Bearer ${TOKEN}`), { env, now, fetchImpl: stub({ usage: recent }) })).status, 429);
  const day = Array.from({ length: LIMITS.perDay }, (_, i) => ({ at: new Date(now - 2 * 3600000 - i * 60000).toISOString() }));
  assert.equal((await guard(req(`Bearer ${TOKEN}`), { env, now, fetchImpl: stub({ usage: day }) })).status, 429);
  assert.ok((await guard(req(`Bearer ${TOKEN}`), { env, now, fetchImpl: stub({ usage: recent.slice(1) }) })).ok);
});
test('refuses if the usage record cannot be written', async () => {
  assert.equal((await guard(req(`Bearer ${TOKEN}`), { env, fetchImpl: stub({ insertOk: false }) })).status, 503);
});
