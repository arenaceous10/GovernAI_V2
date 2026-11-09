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
  await run(() => api().checkAll(early.id, n, STAGE(n).checklist));
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
    await run(() => api().checkAll(live.id, 8, STAGE(8).checklist));
    await run(() => api().submitStage(live.id, 8, 'Change tested.'));
    await as('assessor'); await run(() => api().reviewStage(live.id, 8, 'assessor', 'Approved', `ok ${round}`));
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
console.log(JSON.stringify(results, null, 1));
process.exit(results.every((x) => x.ok) ? 0 : 1);
