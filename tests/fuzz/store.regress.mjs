// Regression checks for the store bugs found by the test sweep (each was reachable from the screens or the API).
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Node', 'getComputedStyle']) Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const H = await import('./.harness.mjs');
const { api } = await H.mount();
const run = async (fn) => { let o; await H.act(async () => { o = await fn(); }); return o; };
const as = (role, org) => run(() => api().setRole(role, org));
const sys = (id) => api().state.systems.find((x) => x.id === id);
const STAGE = (n) => H.STAGES[n - 1];
const results = [];
// Mandatory checks are ticked one by one (bulk ticking only covers the optional ones).
const tickEvery = async (id, n) => {
  await run(() => api().checkAll(id, n, STAGE(n).checklist));
  for (const i of STAGE(n).checklist) { const rec = sys(id).stages?.[n]; if (!rec?.checklist?.[i] && !rec?.skipped?.[i]) await run(() => api().toggleCheck(id, n, i)); }
};
const approveAll = async (id, n, outcomes = {}) => {
  for (const r of H.waitingOn(sys(id))) { await as(r); await run(() => api().reviewStage(id, n, r, outcomes[r]?.[0] || 'Approved', outcomes[r]?.[1] || 'ok')); }
};
const check = async (name, fn) => { try { await fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, error: e.message }); } };

await as('admin'); await run(() => api().resetDemo());
const live = api().state.systems.find((x) => x.status === 'In production' && x.stage === 7);
const early = api().state.systems.find((x) => x.status === 'Active' && x.stage < 7);
const other = api().state.clients.find((c) => c.id !== early.clientId).id;

await check('a client cannot change another organisation\'s product', async () => {
  await as('client', other);
  const before = sys(early.id);
  await run(() => api().saveCard(early.id, { limitations: 'hijack' }));
  await run(() => api().requestWithdrawal(early.id, { category: 'Other', reason: 'Taking over a product that is not mine.' }));
  await run(() => api().register(early.id, { name: 'x' }, before.assessment, []));
  assert.equal(sys(early.id), before);
});
await check('a blocked product under review cannot be approved onwards', async () => {
  await as('client', early.clientId);
  const n = sys(early.id).stage;
  await tickEvery(early.id, n);
  await run(() => api().submitStage(early.id, n, 'Ready.'));
  assert.equal(sys(early.id).stages[n].status, 'submitted');
  const a = sys(early.id).assessment;
  await run(() => api().register(early.id, { name: sys(early.id).name }, { ...a, results: { ...a.results, tier: 'unacceptable' } }, []));
  assert.equal(sys(early.id).status, 'Blocked');
  for (const r of ['assessor', 'lead']) { await as(r); await run(() => api().reviewStage(early.id, n, r, 'Approved', 'ok')); }
  assert.equal(sys(early.id).stage, n, 'did not move on');
  await as('client', early.clientId);
  await run(() => api().register(early.id, { name: sys(early.id).name }, a, []));
  assert.equal(sys(early.id).status, 'Active');
});
await check('a live product unblocked by a re-assessment goes back into production', async () => {
  await as('client', live.clientId);
  const a = live.assessment;
  await run(() => api().register(live.id, { name: live.name }, { ...a, results: { ...a.results, tier: 'unacceptable' } }, []));
  assert.equal(sys(live.id).status, 'Blocked');
  await run(() => api().register(live.id, { name: live.name }, a, []));
  assert.equal(sys(live.id).status, 'In production');
});
await check('a second change keeps the first change\'s record', async () => {
  await as('client', live.clientId);
  for (let round = 0; round < 2; round++) {
    await run(() => api().startEvent(live.id, 'change', `Change ${round + 1}: new model version`));
    await tickEvery(live.id, 8);
    await run(() => api().submitStage(live.id, 8, 'Change tested.'));
    await approveAll(live.id, 8, { assessor: ['Approved', `ok ${round}`], lead: ['Approved', `ok ${round}`] });
    await as('client', live.clientId);
  }
  const x = sys(live.id);
  assert.equal(x.stage, 7);
  const kept = (x.rounds || []).filter((rd) => rd.stage === 8);
  assert.equal(kept.length, 1, 'the first change round is kept');
  assert.ok(kept[0].record.log.some((e) => e.comment === 'ok 0'));
  assert.ok(x.stages[8].log.some((e) => e.comment === 'ok 1'));
});
await check('retired and withdrawn products are read-only', async () => {
  const ret = api().state.systems.find((x) => x.status === 'Retired');
  if (!ret) return;
  await as('client', ret.clientId);
  const before = sys(ret.id);
  await run(() => api().saveCard(ret.id, { limitations: 'late' }));
  await run(() => api().setProductOwner(ret.id, 'Someone'));
  await run(() => api().addAction(ret.id, { action: 'Do something later on', due: '2030-01-01' }));
  assert.equal(sys(ret.id), before);
});
await check('a skip that needs no date never stores one', async () => {
  const y = api().state.systems.find((x) => x.status === 'Active' && x.id !== early.id && ['open', 'returned'].includes(x.stages[x.stage]?.status || 'open'));
  await as('client', y.clientId);
  const n = y.stage; const item = STAGE(n).checklist.find((i) => !H.isMandatory(i, y.assessment.results.tier, {}));
  if (!item) return;
  const msg = await run(() => api().skipCheck(y.id, n, item, { category: 'accepted', reason: 'The business owner accepted this residual risk in writing.', due: 'not-a-date' }));
  assert.equal(msg, '');
  const a = sys(y.id).actions.find((z) => z.item === item);
  assert.match(a.due, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(sys(y.id).stages[n].skipped[item].due, null);
});
await check('deleting a draft that does not exist logs nothing', async () => {
  await as('client', early.clientId);
  const n = api().state.audit.length;
  await run(() => api().deleteDraft(early.id));
  assert.equal(api().state.audit.length, n);
  assert.ok(sys(early.id));
});
await check('ticking checks and attaching evidence are in the audit log', async () => {
  const y = api().state.systems.find((x) => x.status === 'Active' && x.stages[x.stage]?.status !== 'submitted');
  await as('client', y.clientId);
  const n = api().state.audit.length;
  await run(() => api().toggleCheck(y.id, y.stage, STAGE(y.stage).checklist[0]));
  await run(() => api().setEvidence(y.id, y.stage, STAGE(y.stage).evidence[0], { ref: 'https://docs.example/x', file: '' }));
  assert.equal(api().state.audit.length, n + 2);
  assert.match(api().state.audit[0].action, /Evidence attached/);
});
// ---------- governance hardening ----------
await check('bulk ticking leaves every mandatory check for the client, and keeps what was already ticked', async () => {
  const y = api().state.systems.find((x) => x.status === 'Active' && x.id !== early.id && x.stage >= 3 && ['open', 'returned'].includes(x.stages[x.stage]?.status || 'open'));
  await as('client', y.clientId);
  const n = y.stage; const tier = y.assessment.results.tier; const list = STAGE(n).checklist;
  const before = { ...(sys(y.id).stages[n].checklist || {}) };
  await run(() => api().checkAll(y.id, n, list));
  const after = sys(y.id).stages[n].checklist;
  for (const i of list) {
    if (before[i]) assert.equal(after[i], true, `kept: ${i}`);
    else if (H.isMandatory(i, tier, {})) assert.ok(!after[i], `mandatory not bulk-ticked: ${i}`);
    else if (!sys(y.id).stages[n].skipped?.[i]) assert.equal(after[i], true, `optional ticked: ${i}`);
  }
  assert.ok(list.some((i) => H.isMandatory(i, tier, {}) && !before[i]), 'the stage had mandatory checks left to tick');
  assert.ok(H.stageBlockers(sys(y.id)).some((b) => /mandatory/.test(b)));
});
await check('a condition of approval becomes a tracked action, survives a second approver, and blocks go-live until closed', async () => {
  const y = api().state.systems.find((x) => x.status === 'Active' && x.id !== early.id && x.stage >= 3 && x.stage <= 5 && x.assessment.results.tier === 'high');
  assert.ok(y, 'a high-risk demo product before go-live');
  for (let n = y.stage; n < 5; n++) { await as('client', y.clientId); await tickEvery(y.id, n); await run(() => api().submitStage(y.id, n, 'Ready.')); await approveAll(y.id, n); }
  assert.equal(sys(y.id).stage, 5);
  await as('client', y.clientId); await tickEvery(y.id, 5); await run(() => api().submitStage(y.id, 5, 'Ready.'));
  assert.deepEqual(H.waitingOn(sys(y.id)), ['assessor', 'lead']);
  await approveAll(y.id, 5, { assessor: ['Approved with conditions', 'Re-run the subgroup test before go-live'] });
  const x = sys(y.id);
  assert.equal(x.stage, 6);
  const cond = x.actions.filter((a) => a.source === 'condition');
  assert.equal(cond.length, 1); assert.equal(cond[0].stage, 5); assert.equal(cond[0].priority, 'High'); assert.match(cond[0].action, /subgroup test/);
  assert.match(x.stages[5].conditions, /subgroup test/);
  await as('client', y.clientId); await tickEvery(y.id, 6);
  assert.ok(H.stageBlockers(sys(y.id)).some((b) => /condition/.test(b)));
  await run(() => api().submitStage(y.id, 6, 'Trying to go live.'));
  assert.notEqual(sys(y.id).stages[6].status, 'submitted', 'go-live cannot be submitted with an open condition');
  await run(() => api().updateAction(y.id, cond[0].id, { status: 'Done' }));
  // other overdue high-priority actions from the demo data would block too: complete them as the client would
  for (const a of sys(y.id).actions.filter((k) => k.status !== 'Done' && k.priority === 'High' && k.due < new Date().toISOString().slice(0, 10))) await run(() => api().updateAction(y.id, a.id, { status: 'Done' }));
  assert.deepEqual(H.goLiveBlockers(sys(y.id)), []);
  await run(() => api().submitStage(y.id, 6, 'Condition met.'));
  assert.equal(sys(y.id).stages[6].status, 'submitted');
});
await check('an open incident suspends control credit, records its severity, and credit returns when it is closed', async () => {
  const z = api().state.systems.find((x) => x.status === 'In production' && x.stage === 7 && x.assessment.scoring >= 2);
  assert.ok(z, 'a version 2 product in production');
  await as('client', z.clientId);
  for (const a of sys(z.id).actions.filter((k) => k.status !== 'Done' && k.priority === 'High')) await run(() => api().updateAction(z.id, a.id, { due: '2099-01-01' }));
  const calm = sys(z.id).assessment.results;
  assert.ok(!calm.creditSuspended, 'no signal open to start with');
  await run(() => api().startEvent(z.id, 'incident', 'Wrong answers sent to customers', { severity: 'serious', seriousKind: 'general', personalData: true }));
  const hot = sys(z.id);
  assert.equal(hot.stage, 9);
  assert.deepEqual([hot.events.at(-1).severity, hot.events.at(-1).seriousKind, hot.events.at(-1).personalData], ['serious', 'general', true]);
  assert.equal(hot.assessment.results.creditSuspended, true);
  assert.equal(hot.assessment.results.residual, hot.assessment.results.inherent);
  await tickEvery(z.id, 9); await run(() => api().submitStage(z.id, 9, 'Contained and fixed.')); await approveAll(z.id, 9);
  const back = sys(z.id);
  assert.equal(back.stage, 7);
  assert.ok(!back.assessment.results.creditSuspended);
  assert.equal(back.assessment.results.residual, calm.residual);
});
await check('an action marked in progress keeps that status when the product is re-scored', async () => {
  const pickA = (x) => (x.actions || []).find((k) => k.status === 'Open' && ['assessment', 'unknown'].includes(k.source));
  const z = api().state.systems.find((x) => x.status === 'In production' && x.stage === 7 && x.assessment.scoring >= 2 && pickA(x));
  assert.ok(z, 'a product in production with an open action from its assessment');
  await as('client', z.clientId);
  const a = pickA(sys(z.id));
  await run(() => api().updateAction(z.id, a.id, { status: 'In progress' }));
  await run(() => api().startEvent(z.id, 'incident', 'Outage in the scoring service', { severity: 'minor' }));   // opens a breach signal: the product is re-scored
  assert.equal(sys(z.id).assessment.results.creditSuspended, true, 're-scored');
  assert.equal(sys(z.id).actions.find((k) => k.id === a.id).status, 'In progress');
  assert.equal(sys(z.id).events.at(-1).seriousKind, undefined, 'only serious incidents carry a kind');
});
await check('evidence from the registry carries its read date, is refused when the read is old, and never replaces an upload', async () => {
  await as('admin'); await run(() => api().resetDemo());
  const p = api().state.systems.find((x) => x.status === 'Active' && x.stage === 4 && (x.stages?.[4]?.status || 'open') === 'open');
  assert.ok(p, 'a product at stage 4');
  await as('client', p.clientId);
  const item = 'Configuration and version records';
  assert.match(api().attachAuto(p.id, 4, item), /nothing for this item/, 'no connection, nothing to attach');
  const result = { latest: '3', info: { owner: 'risk-team' }, versions: [{ version: '3', runId: 'r3', metrics: { accuracy: 0.93 }, run: { code: { commit: 'abc123def456' }, params: { max_depth: '6' }, flavors: ['sklearn'], datasets: [] } }, { version: '2' }] };
  await run(() => api().connectModel(p.id, { kind: 'databricks-uc', host: 'https://adb-1.2.azuredatabricks.net', model: 'main.claims.triage', tokenSealed: 'v1.x', result }));
  assert.ok(sys(p.id).connector.lastSync, 'connected and read');
  // someone else's text is never stored: the action takes no text at all
  let err; await run(() => { err = api().attachAuto(p.id, 4, item); });
  assert.equal(err, '');
  const ev = sys(p.id).stages[4].evidence[item];
  assert.match(ev.ref, /main\.claims\.triage/); assert.match(ev.ref, /abc123def456/);
  assert.equal(ev.auto.source, 'Databricks'); assert.equal(ev.auto.at, sys(p.id).connector.lastSync); assert.equal(ev.auto.version, '3');
  assert.ok(api().state.audit.some((a) => a.action === 'Evidence attached from Databricks' && String(a.detail).includes(item)), 'it is in the audit log');
  // an item the registry says nothing about
  await run(() => { err = api().attachAuto(p.id, 4, 'Human oversight plan'); });
  assert.match(err, /nothing for this item/);
  await run(() => { err = api().attachAuto(p.id, 4, 'Not an evidence item'); });
  assert.match(err, /cannot be changed/);
  // an upload or a link a person attached is never overwritten
  await run(() => api().setEvidence(p.id, 4, item, { ref: 'https://example.com/config-v3', file: '', at: new Date().toISOString() }));
  await run(() => { err = api().attachAuto(p.id, 4, item); });
  assert.match(err, /already attached/);
  assert.equal(sys(p.id).stages[4].evidence[item].ref, 'https://example.com/config-v3');
  // the administrator's limit is used: a 1-day limit and a read from last week
  await run(() => api().setEvidence(p.id, 4, item, null));
  await as('admin'); await run(() => api().setSetting('autoEvidenceDays', 1));
  await as('client', p.clientId);
  await run(() => api().applyModelSync(p.id, result));
  const RealDate = Date;   // eight days pass
  globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + 8 * 86400000); } static now() { return RealDate.now() + 8 * 86400000; } };
  try { await run(() => { err = api().attachAuto(p.id, 4, item); }); } finally { globalThis.Date = RealDate; }
  assert.match(err, /too long ago/);
  assert.equal(sys(p.id).stages[4].evidence[item], null);
  // other roles cannot attach
  await as('assessor');
  await run(() => { err = api().attachAuto(p.id, 4, item); });
  assert.match(err, /Only the client/);
  await as('admin'); await run(() => api().setSetting('autoEvidenceDays', 30));
});
await check('importing tables marks a dataset as personal when the catalog tags say so, and never switches it off', async () => {
  await as('admin'); await run(() => api().resetDemo());
  const p = api().state.systems.find((x) => x.status === 'Active' && x.stage === 4);
  await as('client', p.clientId);
  await run(() => api().connectModel(p.id, { kind: 'databricks-uc', host: 'https://adb-1.2.azuredatabricks.net', model: 'main.claims.triage', tokenSealed: 'v1.x', result: { latest: '1', versions: [{ version: '1' }] } }));
  const t = (name, tagged) => ({ name, owner: 'data-team', columns: 5, upstream: [], downstream: [], lineageSource: 'system.access.table_lineage', personal: { tagsRead: true, tagged, masked: [], hints: ['postcode'] } });
  await run(() => api().importTables(p.id, [t('main.claims.applicants', [{ column: 'email', tag: 'class.email_address' }]), t('main.claims.rates', [])]));
  const d = (n) => sys(p.id).datasets.find((x) => x.uc?.name === n);
  assert.equal(d('main.claims.applicants').personal, true);
  assert.equal(d('main.claims.applicants').personalFrom, 'Unity Catalog tags');
  assert.deepEqual(d('main.claims.applicants').uc.personal.tagged, [{ column: 'email', tag: 'class.email_address' }]);
  assert.equal(d('main.claims.rates').personal, false, 'name hints alone never mark a dataset as personal');
  // the tag is removed in the catalog: the dataset stays personal until a person decides otherwise
  await run(() => api().importTables(p.id, [t('main.claims.applicants', [])]));
  assert.equal(d('main.claims.applicants').personal, true);
});
await check('lineage read from Databricks is stored cut to size, logged, and marks fed datasets as documented', async () => {
  await as('admin'); await run(() => api().resetDemo());
  const p = api().state.systems.find((x) => x.status === 'Active' && x.stage === 4);
  await as('client', p.clientId);
  await run(() => api().importTables(p.id, [{ name: 'main.gold.features', owner: 'o', columns: 3, upstream: [], downstream: [], lineageSource: null }]));
  const d0 = sys(p.id).datasets.find((d) => d.uc?.name === 'main.gold.features');
  assert.equal(d0.lineage, false);
  const raw = { roots: ['main.gold.features'], layers: 2, source: 'system.access.table_lineage', truncated: null, notes: [],
    nodes: [{ name: 'main.gold.features', kind: 'table', type: 'TABLE' }, { name: 'main.silver.claims', kind: 'table', type: 'TABLE' }, { name: 's3://b/claims', kind: 'path', type: 'PATH' }, { name: 'evil; drop', kind: 'table' }],
    edges: [{ from: 'main.silver.claims', to: 'main.gold.features' }, { from: 's3://b/claims', to: 'main.silver.claims' }, { from: 'evil; drop', to: 'main.silver.claims' }] };
  let err; await run(() => { err = api().saveLineage(p.id, raw); });
  assert.equal(err, '');
  const l = sys(p.id).lineage;
  assert.deepEqual(l.nodes.map((n) => n.name), ['main.gold.features', 'main.silver.claims', 's3://b/claims']);
  assert.equal(l.edges.length, 2);
  assert.ok(l.readAt);
  assert.equal(sys(p.id).datasets.find((d) => d.uc?.name === 'main.gold.features').lineage, true);
  assert.ok(api().state.audit.some((a) => a.action === 'Lineage read from Databricks' && /2 tables, 2 steps upstream of main\.gold\.features/.test(a.detail)));
  await as('assessor');
  await run(() => { err = api().saveLineage(p.id, raw); });
  assert.match(err, /Only the client/);
});
console.log(JSON.stringify(results, null, 1));
process.exit(results.every((x) => x.ok) ? 0 : 1);
