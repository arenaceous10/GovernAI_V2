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
    if (url.includes('/unity-catalog/models/main.risk.claims?')) return json({ aliases: [{ alias_name: 'champion', version_num: 3 }] });
    if (url.includes('/runs/get')) return json({ run: { data: { metrics: [{ key: 'auc', value: 0.91 }, { key: 'bad', value: 'x' }] } } });
    return { ok: false, status: 404, text: async () => '' };
  };
  const ml = await readRegistry({ kind: 'mlflow', host: 'https://ml.example.com', model: 'claims', token: 'tok' }, { fetchImpl, resolve });
  assert.equal(ml.latest, '10'); assert.equal(ml.versions[1].stage, 'Production'); assert.deepEqual(ml.versions[0].metrics, { auc: 0.91 });
  assert.ok(seen.every((s) => s.auth === 'Bearer tok'));
  const uc = await readRegistry({ kind: 'databricks-uc', host: 'https://dbc.example.com', model: 'main.risk.claims', token: 't' }, { fetchImpl, resolve });
  assert.equal(uc.latest, '3'); assert.deepEqual(uc.versions[0].aliases, ['champion']); assert.equal(uc.versions[0].description, 'retrained');
  await assert.rejects(readRegistry({ kind: 'databricks-uc', host: 'https://dbc.example.com', model: 'claims', token: 't' }, { fetchImpl, resolve }), /catalog\.schema\.model/);
  await assert.rejects(readRegistry({ kind: 'mlflow', host: 'https://ml.example.com', model: "x' or name='y", token: 't' }, { fetchImpl, resolve }), /exactly/);
  const redirect = async () => ({ ok: false, status: 302, text: async () => '' });
  await assert.rejects(readRegistry({ kind: 'mlflow', host: 'https://ml.example.com', model: 'claims' }, { fetchImpl: redirect, resolve }), /redirect/);
});
