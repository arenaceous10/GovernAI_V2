// Server code under random and hostile input: the outbound-address guard, sealed tokens, request bodies,
// registry and monitoring responses of any shape, and table names that try to inject SQL.
import { rng, suite, short } from './lib.mjs';
import { createServer } from 'node:http';
import { checkHost, isPrivate, seal, unseal, readRegistry, readMonitoring, readTables, readGenAI, validTable, validWarehouse, safeFetch } from '../../src/lib/server/connector.js';
import { readBody } from '../../src/lib/serverAuth.js';
import { randomBytes } from 'node:crypto';

const S = suite('server');
const r = rng(+process.env.SEED || 3);
const KEY = randomBytes(32).toString('base64');

// 1. Outbound addresses: every private, loopback, link-local or metadata address is refused in every spelling.
const privateV4 = ['127.0.0.1', '10.1.2.3', '172.16.5.4', '172.31.255.255', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1'];
const spell = (ip) => {
  const p = ip.split('.').map(Number); const n = ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
  const hex = (x) => x.toString(16);
  return [ip, String(n), `0x${hex(n)}`, p.map((x) => `0${x.toString(8)}`).join('.'), `${p[0]}.${(p[1] << 16) + (p[2] << 8) + p[3]}`,
    `[::ffff:${ip}]`, `[::ffff:${hex((p[0] << 8) + p[1])}:${hex((p[2] << 8) + p[3])}]`, `[0:0:0:0:0:ffff:${ip}]`, `[64:ff9b::${ip}]`];
};
const privateV6 = ['[::1]', '[::]', '[fd00::1]', '[fc12::5]', '[fe80::1]', '[2002:7f00:1::]'];
const resolve = async (h) => { if (h === 'rebind.example') return [{ address: '127.0.0.1' }]; if (h === 'mixed.example') return [{ address: '93.184.216.34' }, { address: '10.0.0.5' }]; if (h === 'public.example') return [{ address: '93.184.216.34' }]; return []; };
for (let i = 0; i < 4000; i++) {
  const host = r.bool(0.8) ? r.pick(spell(r.pick(privateV4))) : r.pick([...privateV6, 'rebind.example', 'mixed.example', 'localhost', 'x.internal', 'metadata.google.internal', 'foo.local']);
  const url = `${r.pick(['https', 'HTTPS', 'http'])}://${r.bool(0.1) ? 'user:pw@' : ''}${host}${r.pick(['', ':443', ':8443', '/path', '/?o=1'])}`;
  let passed = false;
  try { await checkHost(url, { resolve }); passed = true; } catch { /* refused: correct */ }
  S.check(!passed, 'private address accepted by checkHost', url);
  S.tick();
}
for (let i = 0; i < 500; i++) {
  const url = `https://public.example${r.pick(['', '/', '/ml/models/x?o=12', ':8443/a/b/'])}`;
  let ok = false; try { await checkHost(url, { resolve }); ok = true; } catch { /* */ }
  S.check(ok, 'public address refused', url);
  S.tick();
}
for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700::1111']) S.check(!isPrivate(ip), 'public IP treated as private', ip);
// DNS rebinding: a name that resolves to a private address at connection time is refused by the fetch itself.
const srv = createServer((q, s) => { s.end('{"ok":true}'); }).listen(0);
const port = srv.address().port;
for (const u of [`https://localhost:${port}/`, `https://127.0.0.1:${port}/`]) {
  let got = false; try { await safeFetch(u, {}, {}); got = true; } catch (e) { S.check(/private network|ECONNREFUSED|EPROTO|wrong version|SSL/i.test(e.message), 'unexpected error from the guarded fetch', e.message); }
  S.check(!got, 'guarded fetch reached a private address', u);
  S.tick();
}
// Size cap while streaming.
const big = createServer((q, s) => { s.write('['); const chunk = '"' + 'x'.repeat(65536) + '",'; for (let k = 0; k < 40; k++) s.write(chunk); s.end('""]'); }).listen(0);
let tooBig = false;
try { await safeFetch(`http://localhost:${big.address().port}/`, {}, { allowLocal: true }); } catch (e) { tooBig = /too large/.test(e.message); }
S.check(tooBig, 'response size cap not applied while streaming', ''); S.tick();
srv.close(); big.close();

// 2. Sealed tokens: bound to the product, and any change to the sealed value is refused.
for (let i = 0; i < 2000; i++) {
  const tok = r.str(60) || 'x'; const id = `sys-${r.int(1, 50)}`;
  const s = seal(tok, id, KEY);
  S.check(unseal(s, id, KEY) === tok, 'token does not unseal', '');
  let moved = false; try { unseal(s, id + 'x', KEY); moved = true; } catch { /* */ }
  S.check(!moved, 'sealed token usable on another product', id);
  const raw = Buffer.from(s.slice(3), 'base64'); raw[r.int(0, raw.length - 1)] ^= 1 << r.int(0, 7);
  let tampered = false; try { unseal(`v1.${raw.toString('base64')}`, id, KEY); tampered = true; } catch { /* */ }
  S.check(!tampered, 'tampered sealed token accepted', '');
  S.tick(3);
}

// 3. Request bodies.
for (let i = 0; i < 2000; i++) {
  const body = r.pick([undefined, '', '{', '[]', 'null', JSON.stringify({ productId: r.str(10) }), JSON.stringify({ a: 'x'.repeat(r.int(0, 20000)) }), { productId: 'sys-1' }, 42]);
  const out = await S.run('readBody', () => readBody({ headers: { 'content-length': String(typeof body === 'string' ? body.length : 0) }, body }, 8192), short(body).slice(0, 80));
  if (out) S.check(out.error ? [400, 413].includes(out.status) : typeof out.body === 'object', 'readBody returned an odd result', short(out).slice(0, 120));
  if (out?.body) S.check(out.body !== null && !Array.isArray(out.body) ? true : false, 'readBody accepted a non-object body', short(body).slice(0, 80));
  S.tick();
}

// 4. Table and warehouse names: nothing that could break out of the quoted SQL identifier is accepted.
const evil = ['a.b.c`; DROP TABLE x; --', 'a.b.c d', "a.b.'c'", 'a.b', 'a.b.c.d', 'a..c', '`a`.b.c', 'a.b.c\n', 'a.b.c;', 'ä.b.c', 'a.b.' + 'x'.repeat(300)];
for (let i = 0; i < 2000; i++) {
  const t = r.bool(0.5) ? r.pick(evil) : r.str(20);
  if (validTable(t)) S.check(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t.trim()) && !/[`'";\s]/.test(t.trim()), 'unsafe table name accepted', t);
  const w = r.pick(['2bce45dbd06434d1', "x' OR 1=1", r.str(20), 'abc']);
  if (validWarehouse(w)) S.check(/^[A-Za-z0-9]+$/.test(w.trim()), 'unsafe warehouse id accepted', w);
  S.tick(2);
}

// 5. Registry and monitoring responses of any shape: friendly errors only, never a crash or a leak.
const junk = () => r.pick([null, 1, 'x', [], {}, { model_versions: r.pick([null, 'x', [null, 1, { version: r.pick([null, 3, '2', {}]), aliases: r.pick([null, 'a', ['champion']]), run_id: r.pick(['../../x', 'abc', null]) }]]) },
  { run: { data: { metrics: r.pick([null, [{ key: 'auc', value: 'NaN' }, { key: null, value: 1 }, { key: 'x'.repeat(500), value: 1e308 }]]) } } },
  { status: { state: r.pick(['SUCCEEDED', 'FAILED']), error: { message: 'x' } }, result: { data_array: r.pick([null, [[1, 2]], 'x']) }, manifest: { schema: { columns: r.pick([null, [{ name: 'column_name' }]]) } } }]);
const fakeFetch = async (url) => {
  const st = r.pick([200, 200, 200, 200, 404, 403, 500, 302]);
  const body = r.bool(0.1) ? 'not json' : JSON.stringify(junk());
  return { status: st, ok: st >= 200 && st < 300, text: async () => body };
};
const friendly = (e) => typeof e?.message === 'string' && e.message.length < 300 && !/TypeError|undefined|Cannot read properties|is not a function|of null/.test(e.message);
for (let i = 0; i < 1500; i++) {
  const kind = r.pick(['mlflow', 'databricks-uc']);
  try { await readRegistry({ kind, host: 'https://public.example', model: kind === 'mlflow' ? 'model' : 'a.b.c', token: 't' }, { fetchImpl: fakeFetch, resolve }); }
  catch (e) { S.check(friendly(e), 'registry read fails with an internal error', e.message); }
  try { await readMonitoring({ base: 'https://public.example', token: 't', table: 'a.b.c', warehouseId: r.pick(['2bce45dbd06434d1', '']) }, { fetchImpl: fakeFetch }); }
  catch (e) { S.check(friendly(e), 'monitoring read fails with an internal error', e.message); }
  try { await readGenAI({ base: 'https://public.example', token: 't', experiment: r.pick(['', '/Users/x/exp', '123']), versions: [] }, { fetchImpl: fakeFetch }); }
  catch (e) { S.check(friendly(e), 'GenAI read fails with an internal error', e.message); }
  try { await readTables({ base: 'https://public.example', token: 't', tables: ['a.b.c', 'd.e.f'], warehouseId: '2bce45dbd06434d1' }, { fetchImpl: fakeFetch }); }
  catch (e) { S.check(friendly(e), 'table read fails with an internal error', e.message); }
  S.tick(4);
}
// 6. Drift rows repeated per granularity and model id are counted once, and the timestamp column never drifts.
const rowsFor = () => {
  const cols = ['age', 'bmi', 'smoker', 'ts', 'prediction'];
  const out = [];
  for (const g of ['1 day', '1 week']) for (const mid of ['*', 'v1']) for (const c of cols) for (const dt of ['CONSECUTIVE', 'BASELINE'])
    out.push({ window: JSON.stringify({ start: '2026-11-07T00:00:00Z', end: '2026-11-08T00:00:00Z' }), granularity: g, model_id: mid, column_name: c, drift_type: dt, js_distance: 0, population_stability_index: c === 'ts' ? 0 : 5, ks_test: JSON.stringify({ pvalue: c === 'ts' ? 0 : 0.9 }), slice_key: null });
  return out;
};
const cols = ['window', 'granularity', 'model_id', 'column_name', 'drift_type', 'js_distance', 'population_stability_index', 'ks_test', 'slice_key'];
const monFetch = async (url, init) => {
  const j = /tables\/[^/]+$/.test(url) && !init?.body ? { table_id: 'tid' }
    : /data-quality/.test(url) ? { data_profiling_config: { status: 'ACTIVE', drift_metrics_table_name: 'a.b.c_drift_metrics', profile_metrics_table_name: 'a.b.c_profile_metrics', inference_log: { timestamp_col: 'ts' } } }
    : /statements/.test(url) ? (JSON.parse(init.body).statement.includes('drift') ? { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: cols.map((name) => ({ name })) } }, result: { data_array: rowsFor().map((x) => cols.map((c) => x[c])) } } : { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [] } }, result: { data_array: [] } })
    : {};
  return { status: 200, ok: true, text: async () => JSON.stringify(j) };
};
const mon = await readMonitoring({ base: 'https://public.example', token: 't', table: 'a.b.c', warehouseId: '2bce45dbd06434d1' }, { fetchImpl: monFetch });
S.check(mon.drift && mon.drift.checked === 4, 'drift columns counted more than once', short(mon.drift));
S.check(mon.drift && new Set(mon.drift.drifted.map((d) => d.column)).size === mon.drift.drifted.length, 'drifted column listed twice', short(mon.drift?.drifted));
S.check(mon.drift && !mon.drift.drifted.some((d) => d.column === 'ts'), 'timestamp column reported as drift', short(mon.drift?.drifted));
S.tick(3);
console.log(JSON.stringify(S.report(), null, 1));
