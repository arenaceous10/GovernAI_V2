// The AI endpoint's gate: sign-in, role and rate limit, against a stubbed Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { guard } from '../src/lib/aiGuard.js';
import { scrubText, looksSensitive } from '../src/lib/redact.js';

const env = { VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' };
const TOKEN = 'eyJ' + 'a'.repeat(40);
function stub({ user = { id: 'u1', email: 'priya.nair@x.test' }, profile = { role: 'client', status: 'active', name: 'Priya Nair', client_id: 'cli-1' }, verdict = 'ok', rpcOk = true } = {}) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url, opts });
    const json = (v, ok = true) => ({ ok, json: async () => v });
    if (url.endsWith('/auth/v1/user')) return opts.headers.Authorization === `Bearer ${TOKEN}` && user ? json(user) : json({}, false);
    if (url.includes('/v2_profiles')) return json(profile ? [profile] : []);
    if (url.endsWith('/rpc/ai_usage_take')) return json(verdict, rpcOk);
    if (url.includes('/v2_clients')) return json([{ name: 'Acme Insure' }]);
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
test('allows an active client, takes one unit atomically and returns names to scrub', async () => {
  const f = stub();
  const r = await guard(req(`Bearer ${TOKEN}`), { env, fetchImpl: f });
  assert.ok(r.ok);
  assert.equal(f.calls.filter((c) => c.url.endsWith('/rpc/ai_usage_take') && c.opts.method === 'POST').length, 1);
  for (const k of ['Priya Nair', 'Priya', 'Nair', 'Acme Insure']) assert.ok(r.known.includes(k), k);
});
test('refuses over the per-user and the workspace limit', async () => {
  for (const verdict of ['hour', 'day', 'global']) assert.equal((await guard(req(`Bearer ${TOKEN}`), { env, fetchImpl: stub({ verdict }) })).status, 429, verdict);
  assert.equal((await guard(req(`Bearer ${TOKEN}`), { env, fetchImpl: stub({ verdict: 'forbidden' }) })).status, 403);
});
test('refuses if the usage function fails (fails closed)', async () => {
  assert.equal((await guard(req(`Bearer ${TOKEN}`), { env, fetchImpl: stub({ rpcOk: false }) })).status, 503);
});

test('Unicode tricks do not get identifiers past the scrubber', () => {
  for (const raw of ['ｐｒｉｙａ＠ｅｘａｍｐｌｅ．ｃｏｍ', 'priya\u200b@example.com', 'call ９８３００ １２３４５', 'PAN ＡＢＣＰＥ１２３４Ｆ']) {
    assert.ok(looksSensitive(raw), raw);
    const out = scrubText(raw);
    assert.ok(!/@|98300|ABCPE/.test(out), `${raw} -> ${out}`);
  }
});
