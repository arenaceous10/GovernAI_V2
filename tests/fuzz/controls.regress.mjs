// Control assessment at stage 2: registration with the risk profile only, a provisional tier, evidence rules,
// the reviewer's lower rating, and confirmation when stage 2 is approved. Runs the real store.
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
const results = [];
const check = async (name, fn) => { try { await fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, error: e.message }); } };
const TIER_RANK = { minimal: 0, limited: 1, high: 2, unacceptable: 3 };

await as('admin'); await run(() => api().resetDemo());
const org = api().state.clients[0].id;
const profileOf = (level) => ({ ...H.emptyProfile(), name: 'Staged product', description: 'A product registered with the risk profile only.', domain: 'insurance', systemType: 'ml', sourcing: 'build', geos: ['IN'], data: ['personal'],
  answers: Object.fromEntries(H.PROFILE_QUESTIONS.map((q) => [q.id, level === 'top' ? q.options.length - 1 : 0])) });
const registerStaged = async (level, fws = ['DPDP']) => {
  await as('client', org);
  const base = { at: new Date().toISOString(), by: 'client', profile: profileOf(level), frameworks: fws, questions: [], answers: {}, flow: H.FLOW, questionSource: '' };
  return run(() => api().register(null, { name: `Staged ${level}`, bu: '', owner: 'Owner', description: base.profile.description }, { ...base, results: H.rescore(base) }, []));
};
const tickEvery = async (id, n) => {   // mandatory checks are ticked one by one
  await run(() => api().checkAll(id, n, H.STAGES[n - 1].checklist));
  for (const i of H.STAGES[n - 1].checklist) { const rec = sys(id).stages?.[n]; if (!rec?.checklist?.[i] && !rec?.skipped?.[i]) await run(() => api().toggleCheck(id, n, i)); }
};
const passStage = async (id, n) => {
  await as('client', org);
  await tickEvery(id, n);
  await run(() => api().submitStage(id, n, 'Ready.'));
  for (const r of H.waitingOn(sys(id))) { await as(r); await run(() => api().reviewStage(id, n, r, 'Approved', 'ok')); }
};
const fullAnswers = (qs, level) => Object.fromEntries(qs.map((q) => [q.id, level]));
const proof = (qs) => Object.fromEntries(qs.map((q) => [q.id, { ref: 'https://example.com/policy.pdf', at: '2026-11-10T00:00:00Z' }]));

const allQ = (profile) => { const b = H.buildQuestionnaire(profile, ['DPDP']); return [...b.fixed, ...b.adaptive]; };
let id; let qs;
await check('registration with the risk profile alone gives a provisional tier that equals the inherent tier', async () => {
  id = await registerStaged('top');
  const r = sys(id).assessment.results;
  assert.equal(r.provisional, true);
  assert.equal(r.tier, r.inherentTier);
  assert.equal(r.residual, r.inherent);
  assert.equal(r.questionCount, 0);
  assert.equal(sys(id).status, 'Active');
  assert.ok(!sys(id).actions.some((x) => x.source === 'assessment'), 'no control gap actions before controls are answered');
});
await check('questions are written in the background after registration, without touching the score', async () => {
  const before = sys(id).assessment.results;
  await run(() => api().prepareControls(id));
  const a = sys(id).assessment;
  assert.ok(a.questions.length >= 16, 'questions prepared');
  assert.deepEqual(a.answers, {});
  assert.equal(a.results, before);
  assert.equal(H.controlGaps(a).prepared, true);
  assert.equal(H.controlGaps(a).started, false, 'prepared is not started');
  await run(() => api().prepareControls(id));
  assert.equal(sys(id).assessment.questions.length, a.questions.length, 'a second call changes nothing');
});
await check('stage 1 passes without controls; stage 2 cannot be submitted until they are answered and backed', async () => {
  await passStage(id, 1);
  assert.equal(sys(id).stage, 2);
  await as('client', org);
  await tickEvery(id, 2);
  assert.ok(H.stageBlockers(sys(id)).some((b) => /Control assessment not started/.test(b)));
  await run(() => api().submitStage(id, 2, 'Trying early.'));
  assert.equal(sys(id).stages[2].status, 'open');
  qs = allQ(sys(id).assessment.profile);
  await run(() => api().saveControls(id, { questions: qs, answers: fullAnswers(qs.slice(0, 3), 1), evidence: {}, source: 'Rule-based tailoring' }));
  assert.ok(H.stageBlockers(sys(id)).some((b) => /still to answer/.test(b)));
  await run(() => api().saveControls(id, { questions: qs, answers: fullAnswers(qs, 3), evidence: {}, source: 'Rule-based tailoring' }));
  assert.ok(H.stageBlockers(sys(id)).some((b) => /need evidence|needs evidence/.test(b)), 'Evidenced without proof blocks the stage');
  await run(() => api().submitStage(id, 2, 'Still not allowed.'));
  assert.equal(sys(id).stages[2].status, 'open');
});
await check('evidence rules: Evidenced needs a file or link, In place a reference, critical In place on a High profile needs proof', async () => {
  const crit = qs.find((q) => q.weight === 3); const norm = qs.find((q) => q.weight !== 3);
  assert.equal(H.evidenceNeed(norm, 3, 'limited'), 'proof');
  assert.equal(H.evidenceNeed(norm, 2, 'high'), 'reference');
  assert.equal(H.evidenceNeed(crit, 2, 'high'), 'proof');
  assert.equal(H.evidenceNeed(crit, 2, 'limited'), 'reference');
  assert.equal(H.evidenceNeed(norm, 1, 'high'), null);
  assert.equal(H.evidenceMet('proof', { ref: 'see the policy folder' }), false);
  assert.equal(H.evidenceMet('proof', { ref: 'https://example.com/a.pdf' }), true);
  assert.equal(H.evidenceMet('proof', { file: 'report.pdf' }), true);
  assert.equal(H.evidenceMet('reference', { ref: 'Owned by the data office' }), true);
  assert.equal(H.evidenceMet('reference', null), false);
});
await check('while provisional, even perfect declared controls do not lower the tier', async () => {
  await run(() => api().saveControls(id, { questions: qs, answers: fullAnswers(qs, 3), evidence: proof(qs), source: 'Rule-based tailoring' }));
  const r = sys(id).assessment.results;
  assert.equal(H.controlGaps(sys(id).assessment).complete, true);
  assert.equal(r.provisional, true);
  assert.equal(r.tier, r.inherentTier);
  assert.equal(r.readiness, 100);
  assert.ok(r.declaredResidual < r.inherent);
  assert.deepEqual(H.stageBlockers(sys(id)), []);
});
await check('only the governance team can rate, only downwards, and only with a reason', async () => {
  const q = qs[0];
  await as('client', org);
  assert.ok(await run(() => api().rateControl(id, q.id, 1, 'Client trying to rate its own control.')));
  assert.equal(sys(id).assessment.review?.[q.id], undefined);
  await as('assessor');
  assert.ok(await run(() => api().rateControl(id, q.id, 3, 'Same level is not lower at all.')));
  assert.ok(await run(() => api().rateControl(id, q.id, 4, 'Higher than the scale allows.')));
  assert.ok(await run(() => api().rateControl(id, q.id, 1, 'short')));
  assert.equal(await run(() => api().rateControl(id, q.id, 1, 'The document attached is a draft policy, not an approved one.')), '');
  const a = sys(id).assessment;
  assert.equal(a.review[q.id].rating, 1);
  assert.equal(a.answers[q.id], 3, 'the client\'s own answer is kept as declared');
  assert.ok(a.results.readiness < 100, 'the score uses the reviewer\'s rating');
  assert.ok(sys(id).actions.some((x) => x.qid === q.id && x.status === 'Open'), 'the lowered control becomes an action');
  assert.ok(api().state.audit.some((e) => e.action === 'Control rating lowered' && e.target === id));
});
await check('answers are locked while stage 2 is with the governance team', async () => {
  await as('client', org);
  await run(() => api().submitStage(id, 2, 'Controls answered.'));
  assert.equal(sys(id).stages[2].status, 'submitted');
  const before = sys(id).assessment;
  await run(() => api().saveControls(id, { questions: qs, answers: fullAnswers(qs, 0), evidence: {}, source: '' }));
  assert.equal(sys(id).assessment, before);
});
await check('approving stage 2 confirms the controls: the tier is final and never stricter than the provisional one', async () => {
  const provisional = sys(id).assessment.results.tier;
  for (const r of H.waitingOn(sys(id))) { await as(r); await run(() => api().reviewStage(id, 2, r, 'Approved', 'Controls checked.')); }
  const x = sys(id); const r = x.assessment.results;
  assert.equal(x.stage, 3);
  assert.ok(x.assessment.controlsConfirmedAt);
  assert.equal(r.provisional, undefined);
  assert.ok(TIER_RANK[r.tier] <= TIER_RANK[provisional]);
  assert.ok(r.residual < r.inherent, 'confirmed controls now lower the score');
  assert.equal(x.history.at(-1).tier, r.tier);
});
await check('after confirmation the client cannot outvote the reviewer, and never edits the reviewer record', async () => {
  const q = qs[0];
  await as('client', org);
  const before = sys(id).assessment.results.readiness;
  await run(() => api().saveControls(id, { questions: qs, answers: { ...fullAnswers(qs, 3), [qs[1].id]: 2 }, evidence: proof(qs), source: '' }));
  assert.equal(sys(id).assessment.review[q.id].rating, 1, 'reviewer rating still applies');
  assert.ok(sys(id).assessment.results.readiness <= before);
  await run(() => api().saveControls(id, { questions: qs, answers: { ...fullAnswers(qs, 3), [q.id]: 1 }, evidence: proof(qs), source: '' }));
  assert.equal(sys(id).assessment.review[q.id].rating, 1, 'the client never edits the reviewer\'s record');
  assert.equal(H.effectiveAnswers(sys(id).assessment.answers, sys(id).assessment.review)[q.id], 1);
});
await check('a prohibited practice still blocks at registration, with no control questions asked', async () => {
  await as('client', org);
  const profile = { ...profileOf('low'), prohibited: [H.PROHIBITED[0].id] };
  const base = { at: new Date().toISOString(), by: 'client', profile, frameworks: ['EU_AI_ACT'], questions: [], answers: {}, flow: H.FLOW, questionSource: '' };
  const bid = await run(() => api().register(null, { name: 'Banned', bu: '', owner: '', description: 'Uses a prohibited practice.' }, { ...base, results: H.rescore(base) }, []));
  assert.equal(sys(bid).status, 'Blocked');
});
await check('adding a framework later keeps the answers and asks only the new questions', async () => {
  const a = sys(id).assessment;
  const next = H.refreshQuestions(a.questions, a.profile, ['DPDP', 'GDPR']);
  assert.ok(next.length > a.questions.length);
  for (const q of a.questions) assert.ok(next.some((n) => n.id === q.id));
  assert.equal(H.controlGaps({ ...a, questions: next }).complete, false);
});
await check('a low-risk staged product also ends no stricter than it started', async () => {
  const lid = await registerStaged('low');
  const start = sys(lid).assessment.results.tier;
  await passStage(lid, 1);
  await as('client', org);
  const lq = allQ(sys(lid).assessment.profile);
  await run(() => api().saveControls(lid, { questions: lq, answers: fullAnswers(lq, 0), evidence: {}, source: '' }));
  await passStage(lid, 2);
  assert.equal(sys(lid).stage, 3);
  assert.ok(TIER_RANK[sys(lid).assessment.results.tier] <= TIER_RANK[start]);
  assert.ok(sys(lid).actions.some((x) => x.source === 'assessment'), 'gaps become actions');
});
await check('products registered the old way are untouched: not provisional, no stage 2 blocker', async () => {
  const old = api().state.systems.find((x) => x.assessment && !H.isStaged(x.assessment) && x.stage === 2 && x.status === 'Active')
    || api().state.systems.find((x) => x.assessment && !H.isStaged(x.assessment));
  assert.equal(H.isProvisional(old.assessment), false);
  assert.ok(!H.stageBlockers(old).some((b) => /Control|control/.test(b)));
  await as('assessor');
  assert.ok(old.assessment.results.provisional === undefined);
});

const bad = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : `: ${r.error}`}`);
console.log(`controls ${results.length - bad.length}/${results.length}`);
process.exit(bad.length ? 1 : 0);
