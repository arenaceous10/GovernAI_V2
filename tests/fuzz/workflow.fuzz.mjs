// Model-based fuzz of the real store: random people (every role and organisation) call random actions on random
// products, including products they should not be able to touch. After every step, invariants are checked.
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Node', 'getComputedStyle']) Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { rng, suite, short } = await import('./lib.mjs');
const H = await import('./.harness.mjs');
const { act, STAGES, requiredApprovals, isMandatory, SKIP_REASONS, WITHDRAW_REASONS } = H;

const STEPS = +process.env.STEPS || 4000;
const seen = {}; const effective = {};
const S = suite('workflow');
const r = rng(+process.env.SEED || 11);
const origErr = console.error; const reactErrs = [];
console.error = (...a) => { reactErrs.push(a.map(String).join(' ').slice(0, 200)); };
const { api } = await H.mount();
const st = () => api().state;
function assess(name) {
  const p = H.emptyProfile();
  Object.assign(p, { name, bu: 'Ops', owner: 'Test Owner', description: 'Scores things for people.', domain: 'insurance', systemType: r.pick(['ml', 'genai', 'rules']), sourcing: 'build', geos: ['IN'], data: ['contact'] });
  for (const q of H.PROFILE_QUESTIONS) p.answers[q.id] = r.bool(0.1) ? H.UNKNOWN : r.int(0, q.options.length - 1);
  if (r.bool(0.15)) p.prohibited = [H.PROHIBITED[0]];
  const fws = r.some(H.SELECTABLE_FRAMEWORKS, 0.5);
  const q = H.buildQuestionnaire(p, fws); const qs = [...q.fixed, ...q.adaptive];
  const answers = Object.fromEntries(qs.map((x) => [x.id, r.int(0, 3)]));
  const results = H.scoreAssessment(p, fws, qs, answers);
  return { meta: { name, bu: p.bu, owner: p.owner, description: p.description }, assessment: { at: new Date().toISOString(), by: 'client', profile: p, frameworks: fws, questions: qs, answers, results }, actions: H.buildActions(qs, answers, results.tier, new Date(), p) };
}
const STATUSES = ['Draft', 'Active', 'Blocked', 'In production', 'Retired', 'Withdrawn'];
const run = async (fn) => { let out; await act(async () => { out = await fn(); }); return out; };
const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const asWho = async (role, org) => run(() => api().setRole(role, org));

const ALLOWED_MOVES = new Set(['1>2', '2>3', '3>4', '4>5', '5>6', '6>7', '7>8', '7>9', '7>10', '8>7', '9>7']);

function checkInvariants(before, after, ctx) {
  const prevById = new Map(before.systems.map((x) => [x.id, x]));
  for (const x of after.systems) {
    const p = prevById.get(x.id);
    S.check(Number.isInteger(x.stage) && x.stage >= 1 && x.stage <= 10, 'stage out of 1-10', short({ ctx, stage: x.stage }));
    S.check(STATUSES.includes(x.status), 'unknown status', short({ ctx, status: x.status }));
    if (x.status !== 'Draft') S.check(!!x.stages?.[x.stage], 'current stage has no record', short({ ctx, id: x.id, stage: x.stage }));
    if (x.stage >= 7 && x.status === 'Active') S.fail('product past go-live shown as Active', short({ ctx, stage: x.stage }));
    if (x.stage < 7 && x.status === 'In production') S.fail('product before go-live shown as In production', short({ ctx, stage: x.stage }));
    if (x.status === 'In production') S.check(x.stage >= 7 && x.stages?.[6]?.status === 'approved', 'in production without stage 6 approved', short({ ctx, stage: x.stage }));
    if (x.status === 'Retired') S.check(x.stages?.[10]?.status === 'approved', 'retired without stage 10 approved', short({ ctx }));
    if (!p) continue;
    if (p === x) continue;
    // Who changed it?
    const role = before.role; const org = before.clientOrg;
    if (role === 'client') S.check(p.clientId === org, 'client changed another organisation\'s product', short({ ctx, org, product: p.clientId }));
    if (p.status === 'Blocked' && p.stage !== x.stage) S.fail('blocked product moved stage', short({ ctx, from: p.stage, to: x.stage }));
    if (p.stage !== x.stage) S.check(ALLOWED_MOVES.has(`${p.stage}>${x.stage}`), 'illegal stage move', short({ ctx, from: p.stage, to: x.stage }));
    if (p.stage !== x.stage && x.stage === p.stage + 1 && p.stage <= 6) {
      const rec = x.stages[p.stage];
      const tier = p.assessment?.results?.tier;
      const need = requiredApprovals(p.stage, tier);
      const overridden = (rec.log || []).some((l) => l.outcome === 'Overridden');
      S.check(rec.status === 'approved', 'moved on without approving the stage', short({ ctx }));
      S.check(overridden || need.every((k) => rec.approvals?.[k] && rec.approvals[k].outcome !== 'Returned'), 'stage approved without every required approval', short({ ctx, need, approvals: rec.approvals }));
      if (!overridden) S.check(p.stages[p.stage]?.status === 'submitted', 'stage approved without being submitted', short({ ctx, was: p.stages[p.stage]?.status }));
    }
    if (p.status === 'Withdrawn') S.check(role === 'admin' || role === 'lead' && false || (x.status !== 'Withdrawn' && role === 'admin') || role === 'admin', 'withdrawn product changed by non-admin', short({ ctx, role }));
    if (p.status !== 'Withdrawn' && x.status === 'Withdrawn') {
      S.check(['lead', 'admin'].includes(role), 'withdrawn by someone other than a lead or admin', short({ ctx, role }));
      S.check(p.withdrawal?.status === 'requested', 'withdrawn without a request', short({ ctx }));
      S.check(p.stage < 7, 'product past go-live withdrawn', short({ ctx, stage: p.stage }));
    }
    if (ARCH.includes(p.status) && ctx.action !== 'restoreProduct') S.check(JSON.stringify(stripMeta(p)) === JSON.stringify(stripMeta(x)), `archived product changed (${ctx.action})`, short({ ctx, role }));
    if (p.status === 'Retired') S.check(role === 'admin' || JSON.stringify(stripMeta(p)) === JSON.stringify(stripMeta(x)), 'retired product changed', short({ ctx, role }));
    // Nothing recorded is lost: a stage record either stays, grows, or is kept whole in x.rounds.
    const kept = { has: (pr) => (x.rounds || []).some((rd) => rd.record === pr || (JSON.stringify(rd.record.checklist || {}) === JSON.stringify(pr.checklist || {})
      && JSON.stringify(rd.record.evidence || {}) === JSON.stringify(pr.evidence || {}) && (rd.record.log || []).length >= (pr.log || []).length)) };
    for (const [n, pr] of Object.entries(p.stages || {})) {
      const rec = x.stages?.[n];
      if (rec === pr || kept.has(pr)) continue;
      const had = Object.keys(pr.checklist || {}).length + Object.keys(pr.evidence || {}).length + Object.keys(pr.approvals || {}).length + (pr.log || []).length;
      if (!rec) { if (had) S.fail('stage record dropped', short({ ctx, n })); continue; }
      if (role !== 'client') {
        // Only the client works the checklist and evidence.
        if (JSON.stringify(pr.checklist || {}) !== JSON.stringify(rec.checklist || {})) S.fail('non-client changed a checklist', short({ ctx, role, n }));
        if (JSON.stringify(pr.evidence || {}) !== JSON.stringify(rec.evidence || {})) S.fail('non-client changed evidence', short({ ctx, role, n }));
      }
      if ((pr.log || []).length > (rec.log || []).length) S.fail('stage log entries lost', short({ ctx, n }));
    }
    for (const a of x.actions || []) S.check(/^\d{4}-\d{2}-\d{2}$/.test(a.due || ''), 'action with an invalid due date', short({ ctx, a }));
  }
  if (after.systems !== before.systems && after.systems.some((x, i) => x !== before.systems.find((y) => y.id === x.id))) {
    S.check(after.audit.length > before.audit.length || after.audit[0] !== before.audit[0], `product changed without an audit entry (${ctx.action})`, short({ ctx }));
  }
  // What each person can see.
  if (after.role === 'client') S.check(api().systems.every((x) => x.clientId === after.clientOrg), 'client sees another organisation\'s product', ctx.action);
}
const ARCH = ['Withdrawn', 'Retired'];
const stripMeta = (x) => ({ ...x, updatedAt: 0 });

const roles = () => {
  const orgs = st().clients.map((c) => c.id);
  return [...orgs.map((o) => ['client', o]), ['assessor'], ['lead'], ['admin']];
};

for (let i = 0; i < STEPS; i++) {
  if (i % 400 === 0) { await asWho('admin'); await run(() => api().resetDemo()); }   // fresh portfolio now and then, for stage coverage
  const [role, org] = r.pick(roles());
  await asWho(role, org);
  const all = st().systems;
  if (!all.length) break;
  // Mostly own products, sometimes anybody's (to test cross-organisation protection).
  const mine = role === 'client' ? all.filter((x) => x.clientId === org) : all;
  const x = r.bool(0.85) && mine.length ? r.pick(mine) : r.pick(all);
  const n = r.bool(0.8) ? x.stage : r.int(1, 10);
  const st0 = STAGES[n - 1];
  const item = r.pick(st0.checklist);
  const ev = r.pick(st0.evidence);
  const A = api();
  const actions = [
    ['toggleCheck', () => A.toggleCheck(x.id, n, item)],
    ['checkAll', () => A.checkAll(x.id, n, st0.checklist)],
    ['skipCheck', () => A.skipCheck(x.id, n, item, { category: r.pick([...SKIP_REASONS.map((s) => s.id), 'bogus']), reason: r.pick(['later', 'This is covered by the vendor contract signed last year.', r.str(40)]), due: r.pick([iso(10), iso(-3), '', 'not-a-date']) })],
    ['unskipCheck', () => A.unskipCheck(x.id, n, item)],
    ['setEvidence', () => A.setEvidence(x.id, n, ev, r.bool(0.8) ? { ref: 'https://example.com/doc', file: '' } : null)],
    ['submitStage', () => A.submitStage(x.id, n, r.str(20))],
    ['submitStage', () => A.submitStage(x.id, n, r.str(20))],
    ['reviewStage', () => A.reviewStage(x.id, n, r.pick(['assessor', 'lead', role]), r.pick(['Approved', 'Approved with conditions', 'Returned']), r.str(30), r.str(10))],
    ['reviewStage', () => A.reviewStage(x.id, n, role, 'Approved', 'ok')],
    ['override', () => A.override(x.id, n, r.str(30))],
    ['startEvent', () => A.startEvent(x.id, r.pick(['change', 'incident', 'retire', 'bogus']), r.str(30))],
    ['saveCard', () => A.saveCard(x.id, { ...(x.card || {}), limitations: r.str(50), tags: [r.str(6)] })],
    ['addAction', () => A.addAction(x.id, { action: r.str(40), due: r.pick([iso(20), 'x', '']), priority: r.pick(['High', 'Low', 'Wild']) })],
    ['updateAction', () => (x.actions?.length ? A.updateAction(x.id, r.pick(x.actions).id, { status: r.pick(['Done', 'Open', 'In progress']) }) : null)],
    ['saveData', () => A.saveData(x.id, (x.datasets || []).map((d) => ({ ...d, steward: r.str(8) })), x.outputs || [])],
    ['setProductOwner', () => A.setProductOwner(x.id, r.str(12))],
    ['requestWithdrawal', () => A.requestWithdrawal(x.id, { category: r.pick([...WITHDRAW_REASONS, 'bogus', '']), reason: r.pick(['', 'no', 'The project was cancelled by the business owner in October.']) })],
    ['cancelWithdrawal', () => A.cancelWithdrawal(x.id)],
    ['decideWithdrawal', () => A.decideWithdrawal(x.id, r.bool(), r.pick(['', 'Agreed, duplicate of the motor model.']))],
    ['restoreProduct', () => A.restoreProduct(x.id)],
    ['purgeProduct', () => A.purgeProduct(x.id)],
    ['deleteDraft', () => A.deleteDraft(x.id)],
    ['saveDraft', () => A.saveDraft(null, { step: 2 }, { name: 'Draft ' + r.str(8) })],
    ['registerNew', () => { const a = assess('New ' + r.str(6)); return A.register(null, a.meta, a.assessment, a.actions); }],
    ['reassess', () => { const a = assess(x.name || 'x'); return A.register(x.id, a.meta, a.assessment, a.actions); }],
    ['addControl', () => A.addControl(x.id, { name: r.str(20) })],
    ['setSetting', () => A.setSetting(r.pick(['purgeAfterDays', 'reviewSlaDays']), r.pick([0, 30, -5, 'abc', 5]))],
    ['applyModelSync', () => (x.connector ? A.applyModelSync(x.id, { latest: String(r.int(1, 9)), versions: [], monitoring: null }) : null)],
  ];
  const [name, fn] = r.pick(actions);
  const before = st();
  const ctx = { step: i, role, org, action: name, product: x.id, pstage: x.stage, pstatus: x.status, n };
  const errBefore = reactErrs.length;
  await S.run(`action ${name}`, () => run(fn), short(ctx));
  S.check(reactErrs.length === errBefore, 'React reported an error', short({ ctx, err: reactErrs.at(-1) }));
  checkInvariants(before, st(), ctx);
  S.tick();
  seen[`${x.stage}/${x.status}`] = (seen[`${x.stage}/${x.status}`] || 0) + 1;
  if (st().systems !== before.systems) effective[name] = (effective[name] || 0) + 1;
  // Now and then, push a random product through its stage the legitimate way, so later stages get exercised.
  if (r.bool(0.15)) {
    const y = r.pick(st().systems.filter((z) => !['Draft', 'Retired', 'Withdrawn', 'Blocked'].includes(z.status)));
    if (y) {
      await asWho('client', y.clientId);
      const sn = STAGES[y.stage - 1];
      const b1 = st();
      await run(() => api().checkAll(y.id, y.stage, sn.checklist)); checkInvariants(b1, st(), { action: 'drive:checkAll' });
      const b2 = st();
      await run(() => api().submitStage(y.id, y.stage, 'Ready for review, all checks done.')); checkInvariants(b2, st(), { action: 'drive:submit' });
      for (const who of ['assessor', 'lead']) {
        await asWho(who);
        const b3 = st();
        await run(() => api().reviewStage(y.id, y.stage, who, 'Approved', 'Looks fine'));
        checkInvariants(b3, st(), { action: `drive:review:${who}` });
      }
      S.tick(4);
    }
  }
}
console.error = origErr;
const final = st();
const byStage = {}; for (const x of final.systems) byStage[`${x.stage}/${x.status}`] = (byStage[`${x.stage}/${x.status}`] || 0) + 1;
console.log(JSON.stringify({ ...S.report(), coverage: seen, effective, reactErrors: [...new Set(reactErrs)].slice(0, 5) }, null, 1));
process.exit(0);
