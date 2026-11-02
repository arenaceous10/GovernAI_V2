import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuestionnaire, scoreAssessment, buildActions, legalClass, validateAiQuestions, emptyProfile,
  principleRisk, inherentScore, evidenceState, evidenceSummary, mentionsOutOfScopeLaw, fixedQuestions,
} from '../src/engine/engine.js';
import { QUESTIONS } from '../src/data/questionBank.js';
import { PRINCIPLES, PRINCIPLE_IDS, PROFILE_QUESTIONS, cutoffsFor, SYSTEM_TYPES } from '../src/data/frameworks.js';
import { profileFlags } from '../src/engine/engine.js';

const allAnswers = (v) => Object.fromEntries(PROFILE_QUESTIONS.map((q) => [q.id, v === 'max' ? q.options.length - 1 : 0]));
const base = (o = {}) => ({ ...emptyProfile(), name: 'X', domain: 'insurance', systemType: 'ml', sourcing: 'build', geos: ['EU', 'IN'], data: ['contact', 'financial', 'health'],
  answers: { impact: 3, scale: 1, footprint: 0, misuse: 0, harm: 1, people: 2, proxies: 1, reversibility: 0, inputs: 1, automation: 1, explain: 1, contest: 2 },
  annex: 'essential', description: 'Prices life insurance premiums', ...o });
const COMBOS = [['EU_AI_ACT'], ['GDPR'], ['DPDP'], ['EU_AI_ACT', 'GDPR'], ['EU_AI_ACT', 'DPDP'], ['GDPR', 'DPDP'], ['EU_AI_ACT', 'GDPR', 'DPDP']];

test('question bank is well formed', () => {
  for (const q of QUESTIONS) {
    assert.equal(q.options.length, 4, q.id);
    assert.ok([1, 2, 3].includes(q.weight), q.id);
    assert.ok(q.action, q.id);
    assert.ok(PRINCIPLES[q.principle], `${q.id} principle`);
    if (q.kind === 'adaptive') { assert.equal(typeof q.when, 'function', q.id); assert.equal(typeof q.rel, 'function', q.id); }
  }
  assert.equal(new Set(QUESTIONS.map((q) => q.id)).size, QUESTIONS.length);
});

test('principle weights add up to 100 and each principle has profile questions', () => {
  assert.equal(PRINCIPLE_IDS.reduce((s, p) => s + PRINCIPLES[p].weight, 0), 100);
  for (const p of PRINCIPLE_IDS) assert.ok(PROFILE_QUESTIONS.some((q) => q.principle === p), p);
});

test('fixed set is stable and split stays 70-80% fixed for every framework combination', () => {
  const profiles = [base(), base({ systemType: 'genai', sourcing: 'foundation', annex: 'none', transparency: ['chat'], description: 'LLM chatbot' }),
    base({ data: ['none'], annex: 'none', domain: 'operations' }), base({ systemType: 'agent', data: ['children', 'biometric'] })];
  for (const fws of COMBOS) {
    const ref = fixedQuestions(profiles[0], fws).map((q) => q.id);
    for (const p of profiles) {
      const { fixed, adaptive } = buildQuestionnaire(p, fws);
      assert.deepEqual(fixed.map((q) => q.id), ref, 'fixed questions must not depend on the use case');
      const share = adaptive.length / (fixed.length + adaptive.length);
      assert.ok(share >= 0.2 && share <= 0.3, `${fws} tailored share ${share.toFixed(2)}`);
      assert.equal(new Set([...fixed, ...adaptive].map((q) => q.id)).size, fixed.length + adaptive.length);
      for (const q of [...fixed, ...adaptive]) assert.ok(Object.keys(q.maps).some((k) => ['RAI', 'DG', ...fws].includes(k)));
    }
    const { fixed, adaptive } = buildQuestionnaire(base(), fws);
    console.log(fws.join('+').padEnd(22), 'fixed', fixed.length, 'tailored', adaptive.length, `${Math.round(100 * fixed.length / (fixed.length + adaptive.length))}% fixed`);
  }
});

test('tailored questions differ by use case', () => {
  const ins = buildQuestionnaire(base(), ['EU_AI_ACT', 'GDPR']).adaptive.map((q) => q.id);
  const bot = buildQuestionnaire(base({ systemType: 'genai', sourcing: 'foundation', annex: 'none', transparency: ['chat', 'synthetic'], data: ['contact'], domain: 'service', description: 'LLM chatbot with RAG' }), ['EU_AI_ACT', 'GDPR']).adaptive.map((q) => q.id);
  assert.notDeepEqual(ins, bot);
  assert.ok(bot.includes('EU-A7'));
});

test('principle risk: all lowest = 0, all highest = 100', () => {
  const lo = principleRisk({ ...emptyProfile(), systemType: 'rules', sourcing: 'build', data: ['none'], answers: allAnswers('min') });
  const hi = principleRisk({ ...emptyProfile(), systemType: 'agent', sourcing: 'foundation', data: ['health'], answers: allAnswers('max') });
  assert.equal(inherentScore(lo), 0); assert.equal(inherentScore(hi), 100);
  for (const p of PRINCIPLE_IDS) { assert.equal(lo[p].risk, 0); assert.equal(hi[p].risk, 100); }
});

test('legal class floor rules', () => {
  assert.equal(legalClass(base({ prohibited: ['x'] })).tier, 'unacceptable');
  assert.equal(legalClass(base()).tier, 'high');
  assert.equal(legalClass(base({ narrowTask: 'yes', profiling: 'no' })).tier, 'minimal');
  assert.equal(legalClass(base({ narrowTask: 'yes', profiling: 'yes' })).tier, 'high');
  assert.equal(legalClass(base({ annex: 'none', transparency: ['chat'] })).tier, 'limited');
  assert.equal(scoreAssessment(base(), ['EU_AI_ACT'], [], {}).tier, 'high', 'Annex III floor under the EU AI Act');
  assert.equal(legalClass(base(), ['GDPR']).tier, 'minimal', 'no EU floor when the EU AI Act is not chosen');
  assert.equal(legalClass(base({ prohibited: ['x'] }), ['DPDP']).tier, 'unacceptable', 'prohibited practices always apply');
});

test('scoring: best vs worst answers, N/A excluded, principles scored', () => {
  const p = base({ annex: 'none' }); const fws = ['GDPR'];
  const { fixed, adaptive } = buildQuestionnaire(p, fws); const qs = [...fixed, ...adaptive];
  const best = Object.fromEntries(qs.map((q) => [q.id, 3])); const worst = Object.fromEntries(qs.map((q) => [q.id, 0]));
  const rb = scoreAssessment(p, fws, qs, best); const rw = scoreAssessment(p, fws, qs, worst);
  assert.equal(rb.readiness, 100); assert.equal(rw.readiness, 0);
  assert.ok(rb.residual < rw.residual);
  for (const k of PRINCIPLE_IDS) { assert.equal(rb.principles[k].readiness, 100, k); assert.ok(rb.principles[k].controls > 0, `${k} has controls`); }
  assert.equal(buildActions(qs, best, rb.tier).length, 0); assert.equal(buildActions(qs, worst, rw.tier).length, qs.length);
  const na = Object.fromEntries(qs.map((q) => [q.id, q.na ? 'na' : 3]));
  assert.equal(scoreAssessment(p, fws, qs, na).readiness, 100);
});

test('evidence states and summary', () => {
  const q = { id: 'x' };
  assert.equal(evidenceState(q, 3, {}), 'unsupported');
  assert.equal(evidenceState(q, 2, { ref: ' ' }), 'unsupported');
  assert.equal(evidenceState(q, 2, { file: 'policy.pdf' }), 'provided');
  assert.equal(evidenceState(q, 1, {}), 'none');
  assert.equal(evidenceState(q, 'na', {}), 'na');
  const qs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const s = evidenceSummary(qs, { a: 3, b: 1, c: 2 }, { b: { ref: 'doc' } }, { a: 'Missing' });
  assert.deepEqual([s.provided, s.unsupported, s.toRate, s.rated, s.Missing], [1, 2, 3, 1, 1]);
});

test('AI validation: rejects bad items and laws outside the chosen frameworks', () => {
  const ok = { q: 'Is the claims triage model reviewed by a claims handler?', framework: 'RAI', principle: 'accountability', options: ['a', 'b', 'c', 'd'], weight: 9 };
  const out = validateAiQuestions([ok, { ...ok, framework: 'HIPAA' }, { ...ok, q: 'Different question here ok?', options: ['a', 'b'] }, ok,
    { ...ok, q: 'Is a GDPR DPIA done for the claims model?' }, { ...ok, q: 'Is the model checked against HIPAA rules?', framework: 'DPDP' }], ['DPDP'], 5);
  assert.equal(out.length, 1); assert.equal(out[0].weight, 3); assert.equal(out[0].source, 'ai'); assert.equal(out[0].principle, 'accountability');
  assert.ok(mentionsOutOfScopeLaw('A DPIA under GDPR', ['DPDP']));
  assert.ok(!mentionsOutOfScopeLaw('A DPIA under GDPR', ['GDPR']));
});

test('admin wording overrides change text only', () => {
  const p = base(); const fws = ['GDPR'];
  const o = { 'GD-C1': { q: 'Custom wording?', options: ['w', 'x', 'y', 'z'] } };
  const q = fixedQuestions(p, fws, o).find((x) => x.id === 'GD-C1');
  assert.equal(q.q, 'Custom wording?'); assert.deepEqual(q.options, ['w', 'x', 'y', 'z']); assert.equal(q.weight, 3);
});

test('tier cut-offs follow the frameworks; the strictest wins', () => {
  assert.deepEqual([cutoffsFor(['DPDP']).limited, cutoffsFor(['DPDP']).high], [40, 65]);
  assert.deepEqual([cutoffsFor(['GDPR', 'DPDP']).limited, cutoffsFor(['GDPR', 'DPDP']).high], [35, 60]);
  assert.deepEqual([cutoffsFor(['EU_AI_ACT', 'DPDP']).limited, cutoffsFor(['EU_AI_ACT', 'DPDP']).high], [30, 55]);
  // the same profile can be High under the EU AI Act and Limited under the DPDP Act
  const p = base({ annex: 'none', data: ['personal'] });
  const r = (fws) => scoreAssessment(p, fws, [], {});
  assert.equal(r(['DPDP']).inherent, r(['EU_AI_ACT']).inherent, 'scoring is common');
  const s0 = r(['DPDP']).inherent;
  if (s0 >= 55 && s0 < 65) { assert.equal(r(['EU_AI_ACT']).tier, 'high'); assert.equal(r(['DPDP']).tier, 'limited'); }
});

test('every AI product type maps to a family used by the tailoring rules', () => {
  for (const t of SYSTEM_TYPES) {
    assert.ok(['rules', 'ml', 'vision', 'genai', 'agent'].includes(t.family), t.id);
    const f = profileFlags({ ...emptyProfile(), systemType: t.id });
    assert.equal(f.systemType, t.family);
  }
  assert.ok(profileFlags({ ...emptyProfile(), systemType: 'chatbot' }).chat);
});
