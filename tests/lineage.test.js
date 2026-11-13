// Lineage built by GovernAI itself: starting from the tables the model was trained on, walk upstream in Databricks
// layer by layer, and lay the result out as layers for the graph.
import test from 'node:test';
import assert from 'node:assert/strict';
import { walkLineage } from '../src/lib/server/connector.js';
import { lineageRoots, lineageLayers, cleanLineage } from '../src/engine/lineage.js';

const HOST = 'https://adb-1.2.azuredatabricks.net';
const json = (j, status = 200) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(j) });
const COLS = ['source_table_full_name', 'source_type', 'source_path', 'target_table_full_name', 'last_seen'];
// target <- sources. gold.features is built from two silver tables; those from bronze tables; bronze from files.
const UP = {
  'main.gold.features': [['main.silver.claims', 'TABLE', null], ['main.silver.policies', 'TABLE', null], ['main.gold.features', 'TABLE', null]],
  'main.gold.labels': [['main.silver.claims', 'TABLE', null]],
  'main.silver.claims': [['main.bronze.claims_raw', 'TABLE', null], ['main.ref.codes', 'VIEW', null]],
  'main.silver.policies': [['main.bronze.policies_raw', 'TABLE', null]],
  'main.bronze.claims_raw': [[null, 'PATH', 'abfss://landing@acct.dfs.core.windows.net/claims/2026/11/part-0001.parquet'], [null, 'PATH', 'abfss://landing@acct.dfs.core.windows.net/claims/2026/10/part-0009.parquet']],
  'main.bronze.policies_raw': [[null, 'PATH', 's3://bucket/policies/export.csv'], ['bad name; drop', 'TABLE', null]],
  'main.ref.codes': [['main.silver.claims', 'TABLE', null]],   // a cycle
};
const sqlFetch = (log = [], up = UP) => async (url, init) => {
  if (!/sql\/statements/.test(url)) return json({}, 404);
  const body = JSON.parse(init.body);
  assert.match(body.statement, /system\.access\.table_lineage/);
  assert.ok(!/main\./.test(body.statement), 'table names travel as parameters, never inside the SQL text');
  const targets = body.parameters.map((p) => p.value); log.push(targets);
  const rows = targets.flatMap((t) => (up[t] || []).map(([s, type, path]) => [s, type, path, t, '2026-11-01']));
  return json({ status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: COLS.map((name) => ({ name })) } }, result: { data_array: rows } });
};
const WH = '2bce45dbd06434d1';
const names = (r, kind) => r.nodes.filter((n) => n.kind === kind).map((n) => n.name).sort();

test('lineage is walked upstream layer by layer from the starting tables, one query per layer', async () => {
  const log = [];
  const r = await walkLineage({ base: HOST, token: 't', warehouseId: WH, roots: ['main.gold.features', 'main.gold.labels'] }, { fetchImpl: sqlFetch(log) });
  assert.deepEqual(names(r, 'table'), ['main.bronze.claims_raw', 'main.bronze.policies_raw', 'main.gold.features', 'main.gold.labels', 'main.ref.codes', 'main.silver.claims', 'main.silver.policies']);
  assert.deepEqual(log.map((l) => l.slice().sort()), [
    ['main.gold.features', 'main.gold.labels'],
    ['main.silver.claims', 'main.silver.policies'],
    ['main.bronze.claims_raw', 'main.bronze.policies_raw', 'main.ref.codes'],
  ], 'each table is asked about once, even inside a cycle');
  const has = (from, to) => r.edges.some((e) => e.from === from && e.to === to);
  assert.ok(has('main.silver.claims', 'main.gold.features') && has('main.silver.claims', 'main.gold.labels') && has('main.bronze.claims_raw', 'main.silver.claims'));
  assert.ok(has('main.ref.codes', 'main.silver.claims') && has('main.silver.claims', 'main.ref.codes'), 'a cycle is kept as it is recorded');
  assert.ok(!has('main.gold.features', 'main.gold.features'), 'a table is not its own source');
  assert.equal(r.source, 'system.access.table_lineage');
  assert.equal(r.truncated, null);
  assert.equal(r.layers, 3);
});

test('files a table was loaded from are kept as sources, one per folder, and unsafe names are dropped', async () => {
  const r = await walkLineage({ base: HOST, token: 't', warehouseId: WH, roots: ['main.gold.features'] }, { fetchImpl: sqlFetch() });
  assert.deepEqual(names(r, 'path'), ['abfss://landing@acct.dfs.core.windows.net/claims', 's3://bucket/policies']);
  assert.ok(r.edges.some((e) => e.from === 'abfss://landing@acct.dfs.core.windows.net/claims' && e.to === 'main.bronze.claims_raw'));
  assert.ok(!JSON.stringify(r).includes('drop'), 'a name that is not catalog.schema.table never reaches the result');
  assert.equal(r.nodes.find((n) => n.name === 'main.ref.codes').type, 'VIEW');
});

test('the walk stops at the depth and size limits and says so', async () => {
  const deep = await walkLineage({ base: HOST, token: 't', warehouseId: WH, roots: ['main.gold.features'], maxDepth: 1 }, { fetchImpl: sqlFetch() });
  assert.equal(deep.truncated, 'depth');
  assert.deepEqual(names(deep, 'table'), ['main.gold.features', 'main.silver.claims', 'main.silver.policies']);
  const wide = Object.fromEntries([['a.b.root', Array.from({ length: 200 }, (_, i) => [`a.b.t${i}`, 'TABLE', null])]]);
  const big = await walkLineage({ base: HOST, token: 't', warehouseId: WH, roots: ['a.b.root'], maxNodes: 20 }, { fetchImpl: sqlFetch([], wide) });
  assert.equal(big.truncated, 'size');
  assert.ok(big.nodes.length <= 20);
  assert.ok(big.edges.every((e) => big.nodes.some((n) => n.name === e.from) && big.nodes.some((n) => n.name === e.to)), 'no edge points at a table that was left out');
});

test('starting tables are checked: nothing to start from, or an unsafe name, is refused in plain words', async () => {
  await assert.rejects(walkLineage({ base: HOST, token: 't', warehouseId: WH, roots: [] }, { fetchImpl: sqlFetch() }), /no table to start from/i);
  await assert.rejects(walkLineage({ base: HOST, token: 't', warehouseId: WH, roots: ['a.b.c`; DROP'] }, { fetchImpl: sqlFetch() }), /catalog\.schema\.table/);
});

test('without a SQL warehouse, or when the system table is not readable, the lineage endpoint is used instead', async () => {
  const api = async (url) => {
    const u = new URL(url);
    if (/sql\/statements/.test(u.pathname)) return json({ status: { state: 'FAILED', error: { message: "INSUFFICIENT_PERMISSIONS: Principal 'sp' does not have USE SCHEMA on Schema 'system.access'" } } });
    if (!/lineage-tracking\/table-lineage/.test(u.pathname)) return json({}, 404);
    const t = u.searchParams.get('table_name');
    const ups = (UP[t] || []).filter(([s]) => s && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(s)).map(([s]) => { const [c, sc, n] = s.split('.'); return { tableInfo: { catalog_name: c, schema_name: sc, name: n } }; });
    return json({ upstreams: ups });
  };
  for (const warehouseId of ['', WH]) {
    const r = await walkLineage({ base: HOST, token: 't', warehouseId, roots: ['main.gold.features'] }, { fetchImpl: api });
    assert.equal(r.source, 'lineage API (unofficial)');
    assert.ok(r.nodes.some((n) => n.name === 'main.bronze.claims_raw'), 'still several layers');
    assert.equal(r.notes.length, warehouseId ? 1 : 0);
  }
  await assert.rejects(walkLineage({ base: HOST, token: 't', warehouseId: '', roots: ['main.gold.features'] }, { fetchImpl: async () => json({}, 403) }), /lineage could not be read/i);
});

test('a table with no recorded lineage gives a result with just that table, not an error', async () => {
  const r = await walkLineage({ base: HOST, token: 't', warehouseId: WH, roots: ['main.lonely.table'] }, { fetchImpl: sqlFetch() });
  assert.deepEqual(r.nodes.map((n) => n.name), ['main.lonely.table']);
  assert.deepEqual(r.edges, []);
  assert.equal(r.layers, 0);
});

// ---------- where the walk starts ----------
test('the walk starts from the tables the model was trained on, plus tables already registered from the catalog', () => {
  const connector = { versions: [{ version: '3', aliases: ['champion'], run: { datasets: [{ table: 'main.gold.features' }, { table: null }] }, dependencies: { tables: ['main.gold.labels'] } }] };
  const datasets = [{ name: 'x', uc: { name: 'main.gold.extra' } }, { name: 'Typed by hand' }];
  assert.deepEqual(lineageRoots({ connector, datasets }), ['main.gold.extra', 'main.gold.features', 'main.gold.labels']);
  assert.deepEqual(lineageRoots({ connector: { versions: [] }, datasets: [] }), []);
  assert.deepEqual(lineageRoots({ connector, datasets }, ['main.other.t', 'bad name', 'main.gold.features']), ['main.gold.extra', 'main.gold.features', 'main.gold.labels', 'main.other.t']);
  assert.deepEqual(lineageRoots(null), []);
});

// ---------- layout ----------
const L = {
  readAt: '2026-11-13T10:00:00.000Z', roots: ['main.gold.features', 'main.gold.labels'],
  nodes: ['main.gold.features', 'main.gold.labels', 'main.silver.claims', 'main.silver.policies', 'main.bronze.claims_raw', 'main.ref.codes'].map((name) => ({ name, kind: 'table', type: 'TABLE' })).concat([{ name: 's3://bucket/claims', kind: 'path', type: 'PATH' }]),
  edges: [['main.silver.claims', 'main.gold.features'], ['main.silver.policies', 'main.gold.features'], ['main.silver.claims', 'main.gold.labels'], ['main.bronze.claims_raw', 'main.silver.claims'],
    ['s3://bucket/claims', 'main.bronze.claims_raw'], ['main.ref.codes', 'main.silver.claims'], ['main.silver.claims', 'main.ref.codes']].map(([from, to]) => ({ from, to })),
};
test('the graph is laid out in layers: sources on the left, the model\'s own inputs next to the model', () => {
  const g = lineageLayers(L, [{ id: 'd1', name: 'Features', uc: { name: 'main.gold.features' }, role: 'Training', classification: 'Internal' }, { id: 'd2', name: 'Repair estimates', sourceSystem: 'Garage partner API', role: 'Inference input', classification: 'Internal' }]);
  const col = (name) => g.columns.findIndex((c) => c.some((n) => n.name === name));
  const last = g.columns.length - 1;
  assert.equal(col('main.gold.features'), last); assert.equal(col('main.gold.labels'), last);
  assert.equal(col('Repair estimates'), last, 'a dataset typed by hand sits with the model inputs');
  assert.equal(col('main.silver.claims'), last - 1); assert.equal(col('main.silver.policies'), last - 1);
  assert.equal(col('Garage partner API'), last - 1, 'its source system sits one layer before it');
  assert.equal(col('main.bronze.claims_raw'), last - 2);
  assert.equal(col('s3://bucket/claims'), last - 3);
  assert.ok(col('main.ref.codes') >= 0 && col('main.ref.codes') < last - 1, 'a table in a cycle is still placed, upstream of what it feeds');
  assert.equal(g.columns.length, 4);
  for (const e of g.edges) assert.ok(col(e.from) < col(e.to), `${e.from} -> ${e.to} runs left to right`);
  assert.ok(!g.edges.some((e) => e.from === 'main.silver.claims' && e.to === 'main.ref.codes'), 'the edge that closes a cycle is not drawn backwards');
  assert.equal(g.columns[last].find((n) => n.name === 'main.gold.features').dataset.id, 'd1', 'a registered table carries its dataset');
  assert.equal(g.tables, 6); assert.equal(g.layers, 4);
});

test('with no lineage read yet the layout is the registered datasets and their source systems', () => {
  const g = lineageLayers(null, [{ id: 'd2', name: 'Repair estimates', sourceSystem: 'Garage partner API' }, { id: 'd3', name: 'Policy master', sourceSystem: '' }]);
  assert.equal(g.columns.length, 2);
  assert.deepEqual(g.columns[0].map((n) => n.name).sort(), ['Garage partner API', 'Unknown source']);
  assert.deepEqual(lineageLayers(null, []).columns, []);
});

test('a stored lineage is cut to size and to safe values before it is saved', () => {
  const junk = { roots: ['a.b.c', 5, 'x'.repeat(900)], layers: 'x', truncated: 'nonsense', source: 'y'.repeat(900),
    nodes: [...Array.from({ length: 500 }, (_, i) => ({ name: `a.b.t${i}`, kind: 'table', type: 'TABLE', extra: 'x'.repeat(5000) })), null, { name: {}, kind: 'table' }, { name: 'p', kind: 'weird' }],
    edges: [...Array.from({ length: 2000 }, (_, i) => ({ from: `a.b.t${i}`, to: 'a.b.t0' })), { from: 'a.b.nowhere', to: 'a.b.t0' }, null], notes: ['n'.repeat(900), 7] };
  const c = cleanLineage(junk, '2026-11-13T10:00:00.000Z');
  assert.ok(c.nodes.length <= 150 && c.edges.length <= 500);
  assert.ok(c.nodes.every((n) => typeof n.name === 'string' && n.name.length <= 220 && ['table', 'path'].includes(n.kind) && !('extra' in n)));
  assert.ok(c.edges.every((e) => c.nodes.some((n) => n.name === e.from) && c.nodes.some((n) => n.name === e.to)));
  assert.equal(c.truncated, null); assert.equal(c.layers, 0); assert.ok(c.source.length <= 60);
  assert.deepEqual(c.roots, ['a.b.c']);
  assert.equal(c.readAt, '2026-11-13T10:00:00.000Z');
  assert.ok(JSON.stringify(c).length < 60000);
  assert.equal(cleanLineage(null, 'x'), null);
  const small = cleanLineage({ nodes: [{ name: 'a.b.c', kind: 'table' }, { name: 'a.b.c; drop', kind: 'table' }, { name: 'p', kind: 'weird' }, { name: 's3://b/x', kind: 'path' }], edges: [] }, 'x');
  assert.deepEqual(small.nodes.map((n) => n.name), ['a.b.c', 's3://b/x'], 'only safe table names and file locations are kept');
});

// ---------- the walked lineage as evidence, as a check, and in the Annex IV draft ----------
const { autoEvidence, databricksFlags } = await import('../src/engine/governance.js');
const stored = cleanLineage({ ...L, layers: 4, source: 'system.access.table_lineage', notes: [] }, '2026-11-12T10:00:00.000Z');
const conn = { kind: 'databricks-uc', model: 'main.claims.triage', lastSync: '2026-11-12T10:00:00.000Z', latest: '3', versions: [{ version: '3', aliases: ['champion'], run: { datasets: [{ table: 'main.gold.features' }] } }] };

test('the walked lineage is offered as dataset lineage evidence: layers, tables and the original sources', () => {
  const ev = autoEvidence({ stage: 4, connector: conn, lineage: stored, datasets: [] }, { now: new Date('2026-11-13T10:00:00Z') })['Dataset lineage, version and access record'];
  assert.match(ev.text, /lineage read 2026-11-12: 6 tables and 1 file location, up to 4 steps upstream/);
  assert.match(ev.text, /original sources main\.silver\.policies, s3:\/\/bucket\/claims\./, "tables and files nothing else feeds");
  assert.ok(!/main\.ref\.codes/.test(ev.text.split('original sources')[1] || ''), 'a table inside a cycle is not called an original source');
});

test('lineage answered as documented is not flagged when Databricks recorded it, even if the imported tables show none', () => {
  const base = { assessment: { profile: { data: ['contact'] }, questions: [{ id: 'DG-C2' }], answers: { 'DG-C2': 3 } }, connector: { versions: [] },
    datasets: [{ name: 'f', uc: { name: 'main.gold.features', upstream: [], downstream: [], lineageSource: 'system.access.table_lineage' } }] };
  assert.deepEqual(databricksFlags(base).map((f) => f.id), ['lineage']);
  assert.deepEqual(databricksFlags({ ...base, lineage: stored }).map((f) => f.id), []);
});

test('the Annex IV draft describes the lineage layer by layer', async () => {
  const { annexIV } = await import('../src/engine/docpack.js');
  const { buildSeed } = await import('../src/store/seed.js');
  const base = buildSeed().systems.find((x) => x.assessment && x.stage >= 4);
  const text = JSON.stringify(annexIV({ ...base, lineage: stored }, { client: { name: 'Acme' } }));
  assert.match(text, /Lineage read from Databricks on 12 November 2026, up to 4 steps upstream/);
  assert.match(text, /main\.silver\.claims/);
  assert.match(text, /s3:\/\/bucket\/claims/);
});
