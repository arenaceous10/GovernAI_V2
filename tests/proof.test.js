// Tamper-evident record, signed evidence packs and the model-registry connector (server parts, stubbed network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { verifyChain, compareWithProduct, localLedger, verifyPack, liveExtendsPack, stable, GENESIS } from '../src/lib/ledger.js';
import { loadKey, buildPack } from '../src/lib/server/evidence.js';
import { seal, unseal, checkHost, readRegistry } from '../src/lib/server/connector.js';

const prod = () => ({
  id: 'sys-9', clientId: 'c1', code: 'AI-1', name: 'Claims triage', status: 'Active', stage: 2, createdAt: '2026-11-01T00:00:00Z',
  assessment: { results: { tier: 'high' }, questions: [], answers: {}, frameworks: ['EU_AI_ACT'] },
  stages: { 1: { status: 'approved', checklist: {}, approvals: {}, evidence: { a: { name: 'a.pdf', data: 'data:xyz' } },
    log: [{ at: '2026-11-02T00:00:00Z', who: 'client', outcome: 'Submitted' }, { at: '2026-11-03T00:00:00Z', who: 'assessor', outcome: 'Approved', comment: 'fine' }] }, 2: { status: 'open', log: [] } },
  connector: { kind: 'mlflow', host: 'https://x', model: 'm', tokenSealed: 'v1.secret' },
});

test('a record built from a product verifies, and any edit, deletion or reordering shows', async () => {
  const rows = await localLedger(prod());
  assert.equal(rows[0].prev, GENESIS);
  assert.ok((await verifyChain(rows)).ok);
  assert.ok(compareWithProduct(rows, prod()).ok);
  const edited = rows.map((r) => (r.seq === 2 ? { ...r, body: r.body.replace('Submitted', 'Approved') } : r));
  assert.match((await verifyChain(edited)).problems[0].what, /changed/);
  assert.match((await verifyChain(rows.filter((r) => r.seq !== 2))).problems[0].what, /missing/);
  const p = prod(); p.stages[1].log[1].comment = 'quietly changed';
  const cmp = compareWithProduct(rows, p);
  assert.equal(cmp.ok, false); assert.equal(cmp.unrecorded.length, 1); assert.equal(cmp.missing.length, 1);
});

test('stable JSON ignores key order', () => {
  assert.equal(stable({ b: 1, a: [{ d: 2, c: 3 }] }), stable({ a: [{ c: 3, d: 2 }], b: 1 }));
});

test('evidence packs are signed, checkable offline, and leave out file contents and tokens', async () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const key = loadKey(privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'));
  const rows = await localLedger(prod());
  const pack = await buildPack({ row: { id: 'sys-9', client_id: 'c1', data: prod() }, rows, client: { id: 'c1', name: 'Acme' }, issuedTo: { name: 'Ann', role: 'client' }, key });
  assert.equal(pack.product.stages[1].evidence.a.data, undefined);
  assert.equal(pack.product.connector.tokenSealed, undefined);
  assert.equal(pack.checkedAtIssue.chain, true);
  let v = await verifyPack(pack, key.publicKey);
  assert.equal(v.signature, 'valid'); assert.ok(v.chain.ok); assert.ok(v.matches.ok);
  // change a word in the snapshot: the signature fails
  const t = JSON.parse(JSON.stringify(pack)); t.product.name = 'Something else';
  assert.equal((await verifyPack(t, key.publicKey)).signature, 'invalid');
  // a different key does not verify
  const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  assert.equal((await verifyPack(pack, other)).signature, 'invalid');
  // the live record must still contain the pack's last entry
  assert.deepEqual(liveExtendsPack(rows, pack), { ok: true, newer: 0, changed: [] });
  assert.deepEqual(liveExtendsPack(rows.map((r) => (r.seq === 1 ? { ...r, hash: 'e'.repeat(64) } : r)), pack).changed, [1], 'an early rewritten entry shows');
  assert.equal(liveExtendsPack(rows.map((r) => ({ ...r, hash: 'f'.repeat(64) })), pack).ok, false);
});

test('connector tokens are sealed per product and unreadable without the server key', () => {
  const k = randomBytes(32).toString('base64');
  const s = seal('dapi-123', 'sys-1', k);
  assert.doesNotMatch(s, /dapi/);
  assert.equal(unseal(s, 'sys-1', k), 'dapi-123');
  assert.throws(() => unseal(s, 'sys-2', k), 'bound to the product');
  assert.throws(() => unseal(s, 'sys-1', randomBytes(32).toString('base64')));
});

test('connector refuses private, local and non-https addresses', async () => {
  const resolve = async (h) => (h === 'inside.example.com' ? [{ address: '10.0.0.5' }] : h === 'meta.example.com' ? [{ address: '169.254.169.254' }] : [{ address: '52.1.2.3' }]);
  for (const bad of ['http://dbc.example.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://inside.example.com', 'https://meta.example.com', 'https://u:p@dbc.example.com', 'ftp://x', 'nonsense']) {
    await assert.rejects(checkHost(bad, { resolve }), undefined, bad);
  }
  assert.equal(await checkHost('https://dbc-1.cloud.databricks.com/', { resolve }), 'https://dbc-1.cloud.databricks.com');
  assert.equal(await checkHost('http://localhost:5000', { allowLocal: true, resolve }), 'http://localhost:5000');
});

test('reads MLflow and Unity Catalog registries, newest version first, with run metrics', async () => {
  const resolve = async () => [{ address: '52.1.2.3' }];
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, auth: opts.headers.Authorization });
    const json = (v) => ({ ok: true, status: 200, text: async () => JSON.stringify(v) });
    if (url.includes('/mlflow/model-versions/search')) return json({ model_versions: [{ version: '2', creation_timestamp: 1762400000000, current_stage: 'Production', run_id: 'r2' }, { version: '10', creation_timestamp: 1762500000000, run_id: 'r10' }] });
    if (url.includes('/unity-catalog/models/main.risk.claims/versions')) return json({ model_versions: [{ version: 3, created_at: 1762500000000, run_id: 'r3', comment: 'retrained' }] });
    if (url.includes('/unity-catalog/models/main.risk.claims?')) return json({ comment: 'Claims model', owner: 'ml-team', aliases: [{ alias_name: 'champion', version_num: 3 }] });
    if (url.includes('/runs/get')) return json({ run: { data: { metrics: [{ key: 'auc', value: 0.91 }, { key: 'bad', value: 'x' }] } } });
    return { ok: false, status: 404, text: async () => '' };
  };
  const ml = await readRegistry({ kind: 'mlflow', host: 'https://ml.example.com', model: 'claims', token: 'tok' }, { fetchImpl, resolve });
  assert.equal(ml.latest, '10'); assert.equal(ml.versions[1].stage, 'Production'); assert.deepEqual(ml.versions[0].metrics, { auc: 0.91 });
  assert.ok(seen.every((s) => s.auth === 'Bearer tok'));
  const uc = await readRegistry({ kind: 'databricks-uc', host: 'https://dbc.example.com/browse/catalogs?o=123', model: 'main.risk.claims', token: 't' }, { fetchImpl, resolve });
  assert.ok(seen.some((x) => x.url.startsWith('https://dbc.example.com/api/2.1/unity-catalog/')), 'pasted page address trimmed to the workspace');
  assert.equal(uc.latest, '3'); assert.equal(uc.info.description, 'Claims model'); assert.equal(uc.info.owner, 'ml-team'); assert.deepEqual(uc.versions[0].aliases, ['champion']); assert.equal(uc.versions[0].description, 'retrained');
  await assert.rejects(readRegistry({ kind: 'databricks-uc', host: 'https://dbc.example.com', model: 'claims', token: 't' }, { fetchImpl, resolve }), /catalog\.schema\.model/);
  await assert.rejects(readRegistry({ kind: 'mlflow', host: 'https://ml.example.com', model: "x' or name='y", token: 't' }, { fetchImpl, resolve }), /exactly/);
  const redirect = async () => ({ ok: false, status: 302, text: async () => '' });
  await assert.rejects(readRegistry({ kind: 'mlflow', host: 'https://ml.example.com', model: 'claims' }, { fetchImpl: redirect, resolve }), /redirect/);
});

import { readGenAI, readMonitoring, readTables } from '../src/lib/server/connector.js';
const stub = (routes) => {
  const seen = [];
  const f = async (url, opts) => {
    seen.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
    for (const [re, v] of routes) if (re.test(url)) return typeof v === 'function' ? v(url, opts) : { ok: true, status: 200, text: async () => JSON.stringify(v) };
    return { ok: false, status: 404, text: async () => '' };
  };
  f.seen = seen; return f;
};
const sqlResult = (cols, rows) => ({ status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: cols.map((name) => ({ name })) } }, result: { data_array: rows } });

test('reads GenAI evaluation runs and a trace summary from the experiment of the model version', async () => {
  const f = stub([
    [/runs\/search/, { runs: [
      { info: { run_id: 'e1', run_name: 'eval-v2', start_time: 1762500000000 }, data: { metrics: [{ key: 'safety/mean', value: 1 }, { key: 'correctness/mean', value: 0.8 }, { key: 'loss', value: 3 }] } },
      { info: { run_id: 't1', run_name: 'training' }, data: { metrics: [{ key: 'auc', value: 0.9 }] } }] }],
    [/\/api\/2\.0\/mlflow\/traces\?/, { traces: [{ timestamp_ms: 1762500000000, status: 'OK', execution_time_ms: 300 }, { timestamp_ms: 1762600000000, status: 'ERROR', execution_time_ms: 900 }] }],
  ]);
  const g = await readGenAI({ base: 'https://dbc.example.com', token: 't', versions: [{ version: '2', experimentId: '42' }] }, { fetchImpl: f });
  assert.equal(g.experimentId, '42');
  assert.deepEqual(g.evaluations.map((e) => e.runId), ['e1'], 'training runs are not evaluations');
  assert.deepEqual(g.evaluations[0].metrics, { 'safety/mean': 1, 'correctness/mean': 0.8 });
  assert.equal(g.traces.count, 2); assert.equal(g.traces.errors, 1); assert.equal(g.traces.last, new Date(1762600000000).toISOString());
  assert.deepEqual(f.seen.find((x) => /runs\/search/.test(x.url)).body.experiment_ids, ['42']);
  // a named experiment is looked up by path; a broken trace endpoint does not fail the rest
  const f2 = stub([[/get-by-name/, { experiment: { experiment_id: '7' } }], [/runs\/search/, { runs: [] }]]);
  const g2 = await readGenAI({ base: 'https://x', token: 't', experiment: '/Users/a@b.com/bot' }, { fetchImpl: f2 });
  assert.equal(g2.experimentId, '7'); assert.equal(g2.traces, null); assert.match(g2.notes.join(), /Traces/);
});

test('reads a data profiling monitor, flags drifted columns and live performance', async () => {
  const f = stub([
    [/unity-catalog\/tables\/[^/]+$/, { table_id: 'abc-123' }],
    [/data-quality\/v1\/monitors\/table\/abc-123/, { data_profiling_config: { status: 'MONITOR_STATUS_ACTIVE', drift_metrics_table_name: 'w.d.inf_drift_metrics', profile_metrics_table_name: 'w.d.inf_profile_metrics' } }],
    [/sql\/statements/, (url, opts) => {
      const st = JSON.parse(opts.body).statement;
      const w = JSON.stringify({ start: '2026-11-05T00:00:00Z', end: '2026-11-06T00:00:00Z' });
      const body = st.includes('drift') ? sqlResult(['window', 'column_name', 'drift_type', 'js_distance', 'population_stability_index', 'ks_test', 'slice_key'],
        [[w, 'age', 'CONSECUTIVE', '0.31', '0.4', '{"statistic":0.2,"pvalue":0.001}', null], [w, 'bmi', 'CONSECUTIVE', '0.02', '0.01', '{"statistic":0.01,"pvalue":0.8}', null],
         [JSON.stringify({ end: '2026-11-04T00:00:00Z' }), 'age', 'CONSECUTIVE', '0.5', null, null, null]])
        : sqlResult(['window', 'column_name', 'count', 'accuracy_score', 'f1_score', 'slice_key'], [[w, ':table', '1200', '0.81', '{"macro":0.7,"weighted":0.78}', null]]);
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    }],
  ]);
  const m = await readMonitoring({ base: 'https://dbc.example.com', token: 't', table: 'w.d.inf', warehouseId: 'abcdef1234567890' }, { fetchImpl: f });
  assert.equal(m.monitor.status, 'ACTIVE');
  assert.equal(m.drift.checked, 2, 'only the latest window');
  assert.deepEqual(m.drift.drifted.map((d) => d.column), ['age']);
  assert.equal(m.drift.drifted[0].ksP, 0.001);
  assert.deepEqual(m.performance.metrics, { accuracy_score: 0.81, f1_score: 0.78 });
  assert.match(f.seen.find((x) => x.body?.statement?.includes('drift')).body.statement, /FROM `w`\.`d`\.`inf_drift_metrics`/, 'identifiers quoted');
  // without a warehouse: status only
  const m2 = await readMonitoring({ base: 'https://x', token: 't', table: 'w.d.inf' }, { fetchImpl: f });
  assert.equal(m2.drift, null); assert.match(m2.notes.join(), /SQL warehouse/);
  await assert.rejects(readMonitoring({ base: 'https://x', token: 't', table: 'w.d.inf; DROP TABLE x' }, { fetchImpl: f }), /catalog\.schema\.table/);
});

test('reads Unity Catalog tables with lineage from the system table, passing names as parameters', async () => {
  const f = stub([
    [/unity-catalog\/tables\/w\.d\.applicants$/, { table_id: 't1', owner: 'data@acme', comment: 'Applicants', table_type: 'MANAGED', columns: [{}, {}, {}], updated_at: 1762500000000 }],
    [/unity-catalog\/tables\/w\.d\.applicants\/monitor/, { status: 'MONITOR_STATUS_ACTIVE' }],
    [/sql\/statements/, sqlResult(['source_table_full_name', 'target_table_full_name', 'last_seen'], [['w.d.raw', 'w.d.applicants', 'x'], ['w.d.applicants', 'w.d.training', 'x']])],
  ]);
  const r = await readTables({ base: 'https://dbc.example.com', token: 't', tables: ['w.d.applicants', 'w.d.missing'], warehouseId: 'abcdef1234567890' }, { fetchImpl: f });
  const a = r.tables[0];
  assert.equal(a.owner, 'data@acme'); assert.equal(a.columns, 3);
  assert.deepEqual(a.upstream, ['w.d.raw']); assert.deepEqual(a.downstream, ['w.d.training']);
  assert.equal(a.lineageSource, 'system.access.table_lineage'); assert.equal(a.monitor.status, 'ACTIVE');
  assert.match(r.tables[1].error, /not found/);
  const q = f.seen.find((x) => /sql\/statements/.test(x.url)).body;
  assert.doesNotMatch(q.statement, /applicants/, 'table names are parameters, not pasted into SQL');
  assert.deepEqual(q.parameters.map((p) => p.value), ['w.d.applicants', 'w.d.missing']);
  await assert.rejects(readTables({ base: 'https://x', token: 't', tables: ["x.y.z' OR 1=1"] }, { fetchImpl: f }), /catalog\.schema\.table/);
});
