// Property tests for the assessment engine: random profiles, frameworks, answers and settings.
import { rng, suite, short } from './lib.mjs';
import {
  emptyProfile, principleRisk, inherentScore, legalClass, buildQuestionnaire, scoreAssessment, buildActions,
  answerScore, evidenceState, evidenceSummary, UNKNOWN, orderQuestions, validateAiQuestions, customBank, maturityLevel,
} from '../../src/engine/engine.js';
import {
  PROFILE_QUESTIONS, DATA_CATEGORIES, SYSTEM_TYPES, SOURCING, DOMAINS, ANNEX_III, TRANSPARENCY, PROHIBITED,
  SELECTABLE_FRAMEWORKS, TIERS, PRINCIPLE_IDS, cutoffsFor,
} from '../../src/data/frameworks.js';
import { COUNTRIES } from '../../src/data/countries.js';

const N = +process.env.N || 6000;
const S = suite('engine');
const r = rng(+process.env.SEED || 7);
const geoIds = (COUNTRIES || []).map((c) => c.id || c.code).filter(Boolean);

function randomProfile() {
  const p = emptyProfile();
  p.name = r.str(30); p.bu = r.str(10); p.owner = r.str(12); p.description = r.str(200);
  p.domain = r.pick([...DOMAINS.map((d) => d.id), '', 'nonsense']);
  p.systemType = r.pick([...SYSTEM_TYPES.map((d) => d.id), '', 'nonsense']);
  p.sourcing = r.pick([...SOURCING.map((d) => d.id), '']);
  p.geos = r.some(geoIds.length ? geoIds : ['IN', 'DE', 'GB', 'US'], 0.05);
  p.data = r.some(DATA_CATEGORIES.map((d) => d.id), 0.3);
  p.answers = {};
  for (const q of PROFILE_QUESTIONS) {
    const x = r();
    p.answers[q.id] = x < 0.08 ? UNKNOWN : x < 0.13 ? undefined : x < 0.15 ? 99 : r.int(0, q.options.length - 1);
  }
  p.prohibited = r.bool(0.05) ? [r.pick(PROHIBITED)] : [];
  p.annex = r.pick(ANNEX_III.map((a) => a.id));
  p.narrowTask = r.pick(['yes', 'no']); p.profiling = r.pick(['yes', 'no']);
  p.transparency = r.some(TRANSPARENCY.map((t) => t.id), 0.2);
  return p;
}
function randomAnswers(qs) {
  const a = {};
  for (const q of qs) { const x = r(); a[q.id] = x < 0.1 ? UNKNOWN : x < 0.18 ? undefined : x < 0.22 && q.na ? 'na' : r.int(0, 3); }
  return a;
}
const rank = (t) => TIERS[t].rank;

for (let i = 0; i < N; i++) {
  const p = randomProfile();
  const fws = r.some(SELECTABLE_FRAMEWORKS, 0.5);
  const custom = r.bool(0.1) ? { [r.pick([...SELECTABLE_FRAMEWORKS, 'DEFAULT'])]: { limited: r.int(-10, 110), high: r.int(-10, 110) } } : {};
  const q = await S.run('buildQuestionnaire', () => buildQuestionnaire(p, fws), short({ p, fws }));
  if (!q) continue;
  const qs = orderQuestions([...q.fixed, ...q.adaptive], fws);
  S.check(new Set(qs.map((x) => x.id)).size === qs.length, 'duplicate question ids in a questionnaire', short({ fws }));
  S.check(qs.every((x) => x.options.length === 4 && x.options.every((o) => typeof o === 'string' && o.trim())), 'question without four options', short(qs.find((x) => x.options.length !== 4)));
  S.check(!/\{subject\}/.test(qs.map((x) => x.q).join(' ')), 'unreplaced {subject} in question text', p.domain);
  const share = q.adaptive.length / Math.max(1, qs.length);
  S.check(q.adaptive.length <= q.target, 'more adaptive questions than the target', short({ a: q.adaptive.length, t: q.target }));
  const answers = randomAnswers(qs);
  const res = await S.run('scoreAssessment', () => scoreAssessment(p, fws, qs, answers, custom), short({ fws, custom }));
  S.tick();
  if (!res) continue;
  const inRange = (x) => Number.isFinite(x) && x >= 0 && x <= 100;
  S.check(inRange(res.inherent) && inRange(res.residual) && inRange(res.readiness), 'score out of 0-100', short({ i: res.inherent, r: res.residual, rd: res.readiness }));
  S.check(res.residual <= res.inherent, 'residual above inherent', short({ i: res.inherent, r: res.residual }));
  S.check(rank(res.tier) >= rank(res.legal.tier), 'tier below the legal floor', short({ tier: res.tier, legal: res.legal }));
  S.check(rank(res.tier) <= rank(res.inherentTier), 'residual tier above inherent tier', short({ tier: res.tier, inh: res.inherentTier }));
  if (p.prohibited.length) S.check(res.tier === 'unacceptable', 'prohibited practice not unacceptable', res.tier);
  S.check(res.cutoffs.limited <= res.cutoffs.high, 'tier cut-offs inverted (limited above high)', short({ custom, cut: res.cutoffs }));
  S.check(res.cutoffs.limited >= 0 && res.cutoffs.high <= 100, 'tier cut-offs outside 0-100 accepted by the engine', short(res.cutoffs));
  for (const k of PRINCIPLE_IDS) S.check(inRange(res.principles[k].risk), `principle ${k} risk out of range`, short(res.principles[k]));
  for (const [fw, v] of Object.entries(res.frameworks)) S.check(v.score == null || inRange(v.score), `framework ${fw} score out of range`, short(v));
  S.check(res.unanswered === qs.filter((x) => answers[x.id] == null || answers[x.id] === '').length, 'unanswered count wrong', '');
  // Not known never makes a product look safer than the worst real answer.
  const worst = { ...answers }; for (const x of qs) if (worst[x.id] === UNKNOWN) worst[x.id] = 0;
  const res2 = scoreAssessment(p, fws, qs, worst, custom);
  S.check(res2.residual === res.residual, '"Not known" control scored differently from "Not in place"', short({ a: res.residual, b: res2.residual }));
  // Better controls never raise the residual score.
  const better = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, typeof v === 'number' ? Math.min(3, v + 1) : v]));
  const res3 = scoreAssessment(p, fws, qs, better, custom);
  S.check(res3.residual <= res.residual, 'improving controls raised the residual score', short({ a: res.residual, b: res3.residual }));
  S.check(rank(res3.tier) <= rank(res.tier), 'improving controls raised the tier', short({ a: res.tier, b: res3.tier }));
  // A riskier profile answer never lowers inherent risk.
  const pq = r.pick(PROFILE_QUESTIONS);
  const cur = p.answers[pq.id];
  if (typeof cur === 'number' && cur < pq.options.length - 1 && pq.options[cur + 1].rating >= pq.options[cur].rating) {
    const p2 = { ...p, answers: { ...p.answers, [pq.id]: cur + 1 } };
    S.check(inherentScore(principleRisk(p2)) >= res.inherent, 'riskier profile answer lowered inherent risk', pq.id);
  }
  // Unknown profile answer scores as the highest rating.
  const pU = { ...p, answers: { ...p.answers, [pq.id]: UNKNOWN } };
  const hi = { ...p, answers: { ...p.answers, [pq.id]: pq.options.reduce((m, o, j) => (o.rating > pq.options[m].rating ? j : m), 0) } };
  S.check(inherentScore(principleRisk(pU)) === inherentScore(principleRisk(hi)), '"Not known" profile answer not scored as worst', pq.id);
  // Actions match the answers below "In place" plus unknown profile answers.
  const acts = buildActions(qs, answers, res.tier, new Date('2026-11-09'), p);
  const expect = qs.filter((x) => { const s = answerScore(x, answers[x.id]); return s != null && s < 70; }).length
    + PROFILE_QUESTIONS.filter((x) => p.answers[x.id] === UNKNOWN).length;
  S.check(acts.length === expect, 'action count does not match the gaps', short({ got: acts.length, expect }));
  S.check(new Set(acts.map((a) => a.id)).size === acts.length, 'duplicate action ids', '');
  S.check(acts.every((a) => /^\d{4}-\d{2}-\d{2}$/.test(a.due) && a.due > '2026-11-09'), 'action due date invalid', short(acts[0]));
  const ev = Object.fromEntries(qs.map((x) => [x.id, r.bool(0.3) ? { ref: r.str(5), file: '' } : undefined]));
  const sum = evidenceSummary(qs, answers, ev, {});
  S.check(sum.toRate === sum.provided + sum.unsupported, 'evidence summary counts inconsistent', short(sum));
  S.tick(6);
}

// Cut-offs from settings: admins may type anything; the engine must not produce an impossible band.
for (let i = 0; i < 1500; i++) {
  const custom = { [r.pick(['EU_AI_ACT', 'GDPR', 'DPDP', 'DEFAULT'])]: { limited: r.int(-50, 150), high: r.int(-50, 150) } };
  const c = cutoffsFor(r.some(SELECTABLE_FRAMEWORKS, 0.5), custom);
  S.check(c.limited <= c.high, 'cutoffsFor returns limited above high', short(custom));
  S.tick();
}

// AI-written questions: the validator must reject malformed or out-of-scope ones and never throw.
for (let i = 0; i < 1500; i++) {
  const fws = r.some(SELECTABLE_FRAMEWORKS, 0.5);
  const raw = Array.from({ length: r.int(0, 8) }, () => (r.bool(0.1) ? r.pick([null, 1, 'x', []]) : {
    q: r.bool(0.9) ? r.str(120) + '?' : '', topic: r.str(20), principle: r.pick([...PRINCIPLE_IDS, 'bogus', undefined]),
    options: r.bool(0.85) ? Array.from({ length: r.pick([3, 4, 4, 4, 5]) }, () => r.str(30)) : 'nope',
    section: r.pick([...fws, 'RAI', 'DG', 'EU_AI_ACT', 'HIPAA', undefined]), ref: r.str(10), weight: r.pick([1, 2, 3, 0, 9, '2']), action: r.str(40), why: r.str(40),
  }));
  const out = await S.run('validateAiQuestions', () => validateAiQuestions(raw, fws, 4, []), short(raw).slice(0, 200));
  if (out) {
    const list = Array.isArray(out) ? out : out.questions || [];
    S.check(list.length <= 4, 'AI validator returned more questions than asked', list.length);
    S.check(list.every((x) => x.options?.length === 4), 'AI validator kept a question without four options', short(list[0]));
  }
  S.tick();
}

// Custom questions from settings with bad shapes.
for (let i = 0; i < 500; i++) {
  const c = Array.from({ length: r.int(0, 5) }, () => ({ id: 'CQ-' + r.int(1, 9), q: r.str(30), options: Array.from({ length: r.int(2, 5) }, () => r.str(5)), section: r.pick(['RAI', 'DG', 'GDPR', '', undefined]), weight: r.pick([1, 2, 3, '3', 7, null]), active: r.bool(0.9) }));
  const bank = await S.run('customBank', () => customBank(c), short(c));
  if (bank) S.check(bank.every((b) => [1, 2, 3].includes(b.weight) && b.options.length === 4), 'custom question with a bad weight or options kept', short(bank));
  S.check(new Set((bank || []).map((b) => b.id)).size === (bank || []).length, 'duplicate custom question ids kept', short(c.map((x) => x.id)));
  S.tick();
}
for (let i = 0; i < 300; i++) { const m = maturityLevel(r.int(-20, 130)); S.check(m.level >= 1 && m.level <= 5, 'maturity level out of 1-5', short(m)); S.tick(); }

console.log(JSON.stringify(S.report(), null, 1));
