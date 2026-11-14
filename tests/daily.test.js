// The daily job: what each person is told (the digest), which products are checked against their registry, and how
// a version change is judged minor or material.
import test from 'node:test';
import assert from 'node:assert/strict';
import { digestItems, buildDigests, renderDigest } from '../src/engine/digest.js';
import { changeMateriality, BANK_VERSION, bankStamp, bankOutdated } from '../src/engine/governance.js';
import { runDaily } from '../src/lib/server/daily.js';

const DAY = 86400000;
const NOW = new Date('2026-11-14T03:00:00Z');
const ago = (d) => new Date(NOW.getTime() - d * DAY).toISOString();
const day = (d) => ago(d).slice(0, 10);
const base = (o = {}) => ({ id: 'p1', name: 'Claims triage', clientId: 'c1', status: 'Active', stage: 4, stages: { 4: { status: 'open', checklist: {}, evidence: {} } },
  actions: [], events: [], assessment: { frameworks: ['GDPR'], results: { tier: 'limited' }, profile: {} }, ...o });
const kinds = (x, o = {}) => digestItems(x, { now: NOW, ...o }).map((i) => `${i.for}:${i.kind}`);

test('a quiet product produces nothing', () => {
  assert.deepEqual(digestItems(base(), { now: NOW }), []);
  assert.deepEqual(digestItems(base({ status: 'Withdrawn', actions: [{ status: 'Open', due: day(9), priority: 'High', action: 'x' }] }), { now: NOW }), []);
  assert.deepEqual(digestItems(null, { now: NOW }), []);
});

test('the client is told about a returned stage, overdue and nearly due actions, and an overdue review', () => {
  const x = base({ stages: { 4: { status: 'returned', returnNote: 'Add the oversight plan', evidence: {} } }, nextReview: day(3),
    actions: [{ status: 'Open', due: day(2), priority: 'High', action: 'Sign processor terms' }, { status: 'Open', due: day(-2), priority: 'High', action: 'Name an owner' },
      { status: 'Open', due: day(-20), priority: 'High', action: 'Later' }, { status: 'Done', due: day(9), priority: 'High', action: 'Finished' }, { status: 'Open', due: day(-2), priority: 'Low', action: 'Low soon' }] });
  assert.deepEqual(kinds(x), ['client:returned', 'client:overdue', 'client:due-soon', 'client:review']);
  const it = digestItems(x, { now: NOW });
  assert.match(it[0].text, /Stage 4 .* was returned: Add the oversight plan/);
  assert.match(it[1].text, /1 action past its due date: Sign processor terms/);
  assert.match(it[2].text, /Name an owner/);
  assert.ok(!/Low soon|Later|Finished/.test(JSON.stringify(it)));
});

test('the governance team is told what is waiting for review, and when it is past the review target', () => {
  const x = base({ stages: { 4: { status: 'submitted', submittedAt: ago(1), evidence: {} } } });
  assert.deepEqual(kinds(x), ['team:review-waiting']);
  const late = digestItems(base({ stages: { 4: { status: 'submitted', submittedAt: ago(12), evidence: {} } } }), { now: NOW, settings: { reviewSlaDays: 5 } });
  assert.match(late[0].text, /past the 5-day review target/);
});

test('an open incident with a legal clock is in both digests, with the hours left', () => {
  const x = base({ stage: 9, stages: { 9: { status: 'open', evidence: {} } }, events: [{ kind: 'incident', at: new Date(NOW.getTime() - 60 * 3600000).toISOString(), personalData: true, severity: 'minor', text: 'Leak' }] });
  const it = digestItems(x, { now: NOW });
  assert.deepEqual(it.map((i) => `${i.for}:${i.kind}`), ['client:incident', 'team:incident']);
  assert.match(it[0].text, /GDPR Art\. 33-34: 12 hours left/);
  const past = digestItems({ ...x, events: [{ ...x.events[0], at: ago(5) }] }, { now: NOW });
  assert.match(past[0].text, /passed/);
  assert.deepEqual(digestItems({ ...x, stage: 7, stages: { 7: { status: 'open', evidence: {} } } }, { now: NOW }), [], 'a closed incident (product back in production) has no clock');
});

test('automatic evidence about to expire, or expired, is flagged; evidence people attached is not', () => {
  const ev = (d) => ({ 'Configuration and version records': { ref: 'Databricks: x', auto: { source: 'Databricks', at: ago(d) } }, 'Human oversight plan': { ref: 'https://x.example/p', at: ago(400) } });
  assert.deepEqual(kinds(base({ stages: { 4: { status: 'open', evidence: ev(10) } } })), []);
  const soon = digestItems(base({ stages: { 4: { status: 'open', evidence: ev(27) } } }), { now: NOW });
  assert.deepEqual(soon.map((i) => i.kind), ['evidence-expiring']);
  assert.match(soon[0].text, /expires in 3 days/);
  assert.deepEqual(kinds(base({ stages: { 4: { status: 'open', evidence: ev(40) } } })), ['client:evidence-expired']);
  assert.deepEqual(kinds(base({ stages: { 4: { status: 'open', evidence: ev(10) } } }), { settings: { autoEvidenceDays: 7 } }), ['client:evidence-expired'], 'the administrator\'s limit is used');
  assert.deepEqual(kinds(base({ stages: { 4: { status: 'approved', approvedAt: ago(35), evidence: ev(40) } } })), [], 'an approved stage is not chased');
});

test('what the daily registry check found is reported: a new version, drift, or a token that no longer works', () => {
  const x = base({ connector: { model: 'main.a.b', seenVersion: '3', lastSync: ago(2) } });
  assert.deepEqual(kinds(x, { read: { read_at: ago(0), result: { latest: '4' } } }), ['client:new-version', 'team:new-version']);
  assert.deepEqual(kinds(x, { read: { read_at: ago(0), result: { latest: '3' } } }), []);
  assert.deepEqual(kinds(x, { read: { read_at: ago(0), error: 'auth' } }), ['client:registry-auth']);
  assert.deepEqual(kinds(x, { read: { read_at: ago(0), error: 'other' } }), []);
  assert.deepEqual(kinds(x, { read: { read_at: ago(5), result: { latest: '4' } } }), [], 'a read older than the last one applied says nothing new');
});

test('digests go to the right people: clients see their own organisation, reviewers see the team items', () => {
  const p1 = base({ stages: { 4: { status: 'returned', returnNote: 'Fix', evidence: {} } } });
  const p2 = base({ id: 'p2', name: 'Other org model', clientId: 'c2', stages: { 4: { status: 'submitted', submittedAt: ago(1), evidence: {} } } });
  const people = [
    { id: 'u1', email: 'a@c1.example', name: 'Asha', role: 'client', clientId: 'c1', status: 'active' },
    { id: 'u2', email: 'b@c2.example', name: 'Bo', role: 'client', clientId: 'c2', status: 'active' },
    { id: 'u3', email: 'r@team.example', name: 'Ravi', role: 'assessor', status: 'active' },
    { id: 'u4', email: 'x@team.example', name: 'Off', role: 'lead', status: 'disabled' },
    { id: 'u5', email: 'not-an-email', name: 'Bad', role: 'client', clientId: 'c1', status: 'active' },
  ];
  const d = buildDigests([p1, p2], people, { now: NOW });
  assert.deepEqual(d.map((x) => x.to), ['a@c1.example', 'r@team.example']);
  assert.equal(d[0].products.length, 1); assert.equal(d[0].products[0].name, 'Claims triage');
  assert.equal(d[1].products[0].name, 'Other org model');
  assert.ok(!JSON.stringify(d[0]).includes('Other org model'), 'one organisation never sees another\'s products');
});

test('the email is plain and safe: product names and notes cannot inject markup, and it links to the app', () => {
  const d = buildDigests([base({ name: '<img src=x onerror=1>', stages: { 4: { status: 'returned', returnNote: '<script>alert(1)</script>', evidence: {} } } })],
    [{ id: 'u1', email: 'a@c1.example', name: 'Asha', role: 'client', clientId: 'c1', status: 'active' }], { now: NOW })[0];
  const m = renderDigest(d, { appUrl: 'https://governai-v2.vercel.app' });
  assert.match(m.subject, /GovernAI: 1 item needs you/);
  assert.ok(!/<img|<script/.test(m.html), 'markup is escaped');
  assert.match(m.html, /&lt;script&gt;/);
  assert.match(m.text, /https:\/\/governai-v2\.vercel\.app/);
  assert.match(m.text, /Hello Asha/);
});

// ---------- minor or material ----------
const conn = (v3 = {}, v2 = {}) => ({ versions: [
  { version: '3', metrics: { auc: 0.91, f1: 0.75 }, run: { code: { commit: 'aaa' }, params: { depth: '6' }, datasets: [{ table: 'a.b.t', digest: 'd1' }], ...v3.run }, ...v3.top },
  { version: '2', metrics: { auc: 0.9, f1: 0.75 }, run: { code: { commit: 'aaa' }, params: { depth: '6' }, datasets: [{ table: 'a.b.t', digest: 'd1' }], ...v2.run } }] });

test('a new version with the same code, parameters and data and no worse metrics is minor', () => {
  const m = changeMateriality(conn(), '2', '3');
  assert.equal(m.level, 'minor'); assert.deepEqual(m.reasons, []);
});
test('a metric that fell beyond the tolerance, new code, new parameters or different data make it material', () => {
  assert.deepEqual(changeMateriality(conn({ top: { metrics: { auc: 0.85, f1: 0.75 } } }), '2', '3').reasons, ['auc fell from 0.9 to 0.85']);
  assert.equal(changeMateriality(conn({ top: { metrics: { auc: 0.895, f1: 0.75 } } }), '2', '3').level, 'minor', 'a fall inside 2% is tolerated');
  assert.equal(changeMateriality(conn({ top: { metrics: { auc: 0.895, f1: 0.75 } } }), '2', '3', { tolerancePct: 0 }).level, 'material');
  assert.match(changeMateriality(conn({ run: { code: { commit: 'bbb' } } }), '2', '3').reasons[0], /code/i);
  assert.match(changeMateriality(conn({ run: { params: { depth: '9' } } }), '2', '3').reasons[0], /parameters changed: depth/i);
  assert.match(changeMateriality(conn({ run: { datasets: [{ table: 'a.b.t', digest: 'd1' }, { table: 'a.b.new', digest: 'z' }] } }), '2', '3').reasons[0], /training tables changed: a\.b\.new/i);
});
test('retraining on newer rows of the same tables is minor; a version that cannot be compared is material', () => {
  assert.equal(changeMateriality(conn({ run: { datasets: [{ table: 'a.b.t', digest: 'd2' }] } }), '2', '3').level, 'minor');
  const u = changeMateriality({ versions: [{ version: '3' }, { version: '2' }] }, '2', '3');
  assert.equal(u.level, 'material'); assert.match(u.reasons[0], /cannot be compared/);
  assert.equal(changeMateriality(null, '2', '3').level, 'material');
});

// ---------- question bank version ----------
test('each assessment records the question bank version it answered, and an older one is flagged', () => {
  assert.match(BANK_VERSION, /^\d{4}\.\d{2}$/);
  assert.deepEqual(Object.keys(bankStamp()).sort(), ['bank', 'laws']);
  assert.equal(bankOutdated({ bank: bankStamp() }), false);
  assert.equal(bankOutdated({ bank: { bank: '2025.01', laws: bankStamp().laws } }), true);
  assert.equal(bankOutdated({}), true, 'an assessment made before versions were recorded counts as older');
  assert.equal(bankOutdated(null), false);
});

// ---------- the job itself ----------
const json = (j, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => j, text: async () => JSON.stringify(j) });
function fakeDb({ products, profiles, settings = {} }) {
  const writes = []; const mails = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.host === 'api.resend.com') { mails.push(JSON.parse(init.body)); return json({ id: 'm' }); }
    assert.equal(init.headers.apikey, 'service-key');
    if (/v2_products/.test(u.pathname)) return json(products.map((d) => ({ id: d.id, client_id: d.clientId, data: d })));
    if (/v2_profiles/.test(u.pathname)) return json(profiles.map((p) => ({ id: p.id, email: p.email, name: p.name, role: p.role, client_id: p.clientId, status: p.status })));
    if (/v2_settings/.test(u.pathname)) return json([{ key: 'settings', value: settings }]);
    if (init.method && init.method !== 'GET') { writes.push(url); return json({}, 403); }
    return json({}, 404);
  };
  return { fetchImpl, writes, mails };
}
const env = { VITE_SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key', CONNECTOR_KEY: 'k', RESEND_API_KEY: 're_x', DIGEST_FROM: 'GovernAI <no-reply@example.com>', APP_URL: 'https://governai-v2.vercel.app' };
const people = [{ id: 'u1', email: 'a@c1.example', name: 'Asha', role: 'client', clientId: 'c1', status: 'active' }];

test('the job reads each connected product\'s registry and mails the digest', async () => {
  const p = base({ stage: 7, status: 'In production', stages: { 7: { status: 'open', evidence: {} } }, connector: { kind: 'databricks-uc', host: 'https://adb-1.2.azuredatabricks.net', model: 'main.a.b', tokenSealed: 'v1.x', seenVersion: '3', lastSync: ago(2) } });
  const quiet = base({ id: 'p0', name: 'No registry' });
  const db = fakeDb({ products: [p, quiet], profiles: people });
  const calls = [];
  const out = await runDaily({ env, fetchImpl: db.fetchImpl, now: NOW, readOne: async (c, id) => { calls.push(id); return { latest: '4', versions: [{ version: '4' }] }; } });
  assert.deepEqual(calls, ['p1']);
  assert.equal(db.writes.length, 0, 'the job never writes to the database');
  assert.equal(db.mails.length, 1);
  assert.deepEqual(db.mails[0].to, ['a@c1.example']);
  assert.match(db.mails[0].text, /version 4/);
  assert.deepEqual(out, { ok: true, checked: 1, failed: 0, digests: 1, sent: 1 });
  assert.ok(!JSON.stringify(out).includes('service-key'));
});

test('a registry that refuses the token is recorded as a sign-in failure, and the job carries on', async () => {
  const mk = (id) => base({ id, stage: 7, status: 'In production', stages: { 7: { status: 'open', evidence: {} } }, connector: { kind: 'mlflow', host: 'https://m.example.com', model: 'm', tokenSealed: 'v1.x', seenVersion: '1', lastSync: ago(2) } });
  const db = fakeDb({ products: [mk('pa'), mk('pb')], profiles: people });
  const out = await runDaily({ env, fetchImpl: db.fetchImpl, now: NOW, readOne: async (c, id) => { if (id === 'pa') throw new Error('The registry refused the token (401)'); return { latest: '1', versions: [] }; } });
  assert.equal(out.checked, 2); assert.equal(out.failed, 1);
  assert.match(db.mails[0].text, /could not sign in/);
});

test('without the server keys the job does nothing and says which part is missing; without a mail key it still checks', async () => {
  const none = await runDaily({ env: { VITE_SUPABASE_URL: 'https://x.supabase.co' }, fetchImpl: async () => { throw new Error('must not call'); }, now: NOW });
  assert.deepEqual(none, { ok: false, reason: 'SUPABASE_SERVICE_ROLE_KEY is not set' });
  const p = base({ stages: { 4: { status: 'returned', returnNote: 'Fix', evidence: {} } } });
  const db = fakeDb({ products: [p], profiles: people });
  const out = await runDaily({ env: { ...env, RESEND_API_KEY: '' }, fetchImpl: db.fetchImpl, now: NOW, readOne: async () => ({}) });
  assert.equal(out.digests, 1); assert.equal(out.sent, 0); assert.equal(db.mails.length, 0);
});

test('closed, withdrawn and stage 1 to 3 products are not checked; the oldest reads go first and the run is capped', async () => {
  const mk = (id, o) => base({ id, stage: 7, status: 'In production', stages: { 7: { status: 'open', evidence: {} } }, connector: { kind: 'mlflow', host: 'https://m.example.com', model: 'm', tokenSealed: 'v1.x', seenVersion: '1', lastSync: ago(2) }, ...o });
  const products = [mk('new', { connector: { ...mk('x').connector, lastSync: ago(1) } }), mk('old', { connector: { ...mk('x').connector, lastSync: ago(9) } }), mk('never', { connector: { ...mk('x').connector, lastSync: null } }),
    mk('gone', { status: 'Withdrawn' }), mk('early', { stage: 3, status: 'Active' }), mk('today', { connector: { ...mk('x').connector, lastSync: new Date(NOW.getTime() - 3600000).toISOString() } })];
  const db = fakeDb({ products, profiles: [] });
  const calls = [];
  await runDaily({ env, fetchImpl: db.fetchImpl, now: NOW, readOne: async (c, id) => { calls.push(id); return { latest: '1' }; } });
  assert.deepEqual(calls, ['never', 'old', 'new'], 'withdrawn, pre-stage-4 and just-read products are left out');
  calls.length = 0;
  await runDaily({ env, fetchImpl: db.fetchImpl, now: NOW, max: 2, readOne: async (c, id) => { calls.push(id); return { latest: '1' }; } });
  assert.deepEqual(calls, ['never', 'old']);
});

// ---------- approved versions keep their training details ----------
test('an approval keeps the version\'s training details, so a much later version can still be compared with it', async () => {
  const { approvedVersionEntry, versionDiff } = await import('../src/engine/governance.js');
  const c = conn();
  const e = approvedVersionEntry({ connector: { ...c, latest: '2' }, card: {} }, 6, '2026-01-01T00:00:00Z');
  assert.equal(e.version, '2'); assert.deepEqual(e.metrics, { auc: 0.9, f1: 0.75 }); assert.equal(e.run.code.commit, 'aaa');
  // the registry has moved on and no longer lists version 2 with details
  const later = { versions: [{ version: '9', metrics: { auc: 0.92, f1: 0.75 }, run: { code: { commit: 'aaa' }, params: { depth: '6' }, datasets: [{ table: 'a.b.t', digest: 'd9' }] } }] };
  assert.equal(versionDiff(later, '2', '9'), null);
  assert.equal(versionDiff(later, '2', '9', [e]).metrics[0].from, 0.9);
  assert.equal(changeMateriality(later, '2', '9', { approved: [e] }).level, 'minor');
  assert.equal(approvedVersionEntry({ card: { modelVersion: '1.4' } }, 6, 'x').run, undefined, 'a version typed on the card has no details to keep');
});

// ---------- models in the workspace that nobody registered ----------
test('the workspace\'s registered models are listed, page by page, and the ones with no product are picked out', async () => {
  const { listModels } = await import('../src/lib/server/connector.js');
  const { unregisteredModels } = await import('../src/engine/governance.js');
  const resolve = async () => [{ address: '93.184.216.34' }];
  const pages = { '': { registered_models: [{ full_name: 'main.claims.triage', owner: 'a', updated_at: 1762500000000 }, { full_name: 'main.claims.fraud', owner: 'b' }, { full_name: 'bad name; x' }, null], next_page_token: 'p2' },
    p2: { registered_models: [{ full_name: 'main.hr.screening', owner: 'c' }] } };
  const f = async (url) => { const u = new URL(url); assert.match(u.pathname, /unity-catalog\/models$/); return json(pages[u.searchParams.get('page_token') || '']); };
  f.textWrap = true;
  const fetchImpl = async (url, init) => { const r = await f(url, init); return { ...r, text: async () => JSON.stringify(await r.json()) }; };
  const r = await listModels({ kind: 'databricks-uc', host: 'https://adb-1.2.azuredatabricks.net', token: 't' }, { fetchImpl, resolve });
  assert.deepEqual(r.models.map((m) => m.name), ['main.claims.fraud', 'main.claims.triage', 'main.hr.screening']);
  assert.equal(r.truncated, false);
  const systems = [{ id: 'p1', connector: { host: 'https://adb-1.2.azuredatabricks.net', model: 'main.claims.triage' } }, { id: 'p2', connector: { host: 'https://other.example', model: 'main.hr.screening' } }, { id: 'p3', status: 'Withdrawn', connector: { host: 'https://adb-1.2.azuredatabricks.net', model: 'main.claims.fraud' } }];
  assert.deepEqual(unregisteredModels(r.models, systems, 'https://adb-1.2.azuredatabricks.net/').map((m) => m.name), ['main.claims.fraud', 'main.hr.screening'], 'same workspace only; a withdrawn product does not count');
  const ml = async (url) => { assert.match(url, /registered-models\/search/); const j = { registered_models: [{ name: 'triage', last_updated_timestamp: 1762500000000 }] }; return { status: 200, ok: true, text: async () => JSON.stringify(j) }; };
  assert.deepEqual((await listModels({ kind: 'mlflow', host: 'https://mlflow.example.com', token: 't' }, { fetchImpl: ml, resolve })).models.map((m) => m.name), ['triage']);
});

test('junk product records never break the digest', () => {
  const junk = [null, 5, 'x', {}, { stage: 'x', stages: 'y', actions: 'z', events: 7, connector: 3, nextReview: {} }, { stage: 9, stages: { 9: {} }, events: [{ kind: 'incident', at: 'not a date', personalData: true }], assessment: { frameworks: 'GDPR' } },
    { stage: 4, stages: { 4: { evidence: { a: { auto: { at: {} } }, b: null, c: 'x' } } }, actions: [null, { due: 5 }, { status: 'Open', due: '2020-01-01' }] }];
  for (const x of junk) assert.doesNotThrow(() => digestItems(x, { now: NOW, read: { read_at: 'x', result: 'y' } }), JSON.stringify(x));
  assert.doesNotThrow(() => buildDigests(junk, [null, {}, { status: 'active', email: 'a@b.co', role: 'assessor' }], { now: NOW }));
});
