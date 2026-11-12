// Scoring version 2, legal results per law, role and sector tailoring, and the lifecycle integrity rules
// (conditions, go-live blockers, incident clocks, evidence reuse, registry checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreAssessment, principleRisk, inherentScore, emptyProfile, legalClass, profileFlags, buildQuestionnaire, rankAdaptive,
  rescore, evidenceMet, evidenceNeed, hasLink, SCORING_VERSION, fixedQuestions,
} from '../src/engine/engine.js';
import { QUESTIONS } from '../src/data/questionBank.js';
import { PROFILE_QUESTIONS, PRINCIPLE_IDS, PRINCIPLES, scaleFor, SCALE_CUTOFFS, ANNEX_III, euRoles } from '../src/data/frameworks.js';
import { requiredApprovals, STAGES } from '../src/data/lifecycle.js';
import {
  legalByLaw, consistencyFlags, evidenceReuse, conditionAction, goLiveBlockers, breachSignals, incidentClocks,
  registryChecks, versionCovered, pendingVersions, approvedVersionEntry, compareMetrics, bulkTickable, stageControlGaps,
} from '../src/engine/governance.js';
import { isMandatory } from '../src/data/controls.js';

const low = () => Object.fromEntries(PROFILE_QUESTIONS.map((q) => [q.id, 0]));
const P = (o = {}) => ({ ...emptyProfile(), name: 'X', domain: 'insurance', systemType: 'ml', sourcing: 'build', geos: ['IN'], data: ['contact'], answers: low(), description: 'Routes claims', ...o });
const q = (id, principle, weight = 2, maps = { RAI: 'x' }) => ({ id, kind: 'core', weight, principle, maps, topic: id, action: 'do', options: ['a', 'b', 'c', 'd'] });

// ---------- scoring version 2 ----------
test('v2 risk leans to the worst item: one high rating outweighs two low ones', () => {
  const p = P({ answers: { ...low(), impact: 3 } });               // social: impact 3, scale 1, footprint 1
  const v1 = principleRisk(p, 1).social.risk; const v2 = principleRisk(p, 2).social.risk;
  assert.equal(v1, 33);                                            // plain average (3+1+1)/3
  assert.equal(v2, 60);                                            // 0.4 x worst (3) + 0.6 x average (1.67) = 2.2
  assert.ok(v2 > v1);
});

test('v2 keeps the ends of the scale: all lowest 0, all highest 100', () => {
  const lo = principleRisk(P({ systemType: 'rules', data: ['none'] }), 2);
  const hi = principleRisk(P({ systemType: 'agent', sourcing: 'foundation', data: ['health'], answers: Object.fromEntries(PROFILE_QUESTIONS.map((x) => [x.id, x.options.length - 1])) }), 2);
  assert.equal(inherentScore(lo), 0); assert.equal(inherentScore(hi), 100);
});

test('v2 stakes floor: when an output can decide access or cause serious harm, no principle is rated low', () => {
  const p = P({ systemType: 'rules', data: ['none'], answers: { ...low(), harm: 2 } });   // harm option 2 = serious harm (rating 3)
  const r = principleRisk(p, 2);
  for (const k of PRINCIPLE_IDS) assert.ok(r[k].risk >= 34, `${k} ${r[k].risk}`);
  assert.equal(r.fairness.floored, true);
  assert.equal(principleRisk(p, 1).fairness.risk, 0, 'version 1 is unchanged');
});

test('v2 rates the technology by how it is used: advisory use lowers it, full automation raises it, agents stay high', () => {
  const tech = (o) => principleRisk(P(o), 2).robustness.items.at(-1);
  assert.equal(tech({ systemType: 'genai', answers: { ...low(), automation: 0 } }), 2, 'LLM, advisory only');
  assert.equal(tech({ systemType: 'genai', answers: { ...low(), automation: 1 } }), 3, 'LLM, human in the loop');
  assert.equal(tech({ systemType: 'ml', answers: { ...low(), automation: 2 } }), 3, 'ML, fully automated');
  assert.equal(tech({ systemType: 'ml', answers: { ...low(), automation: 0 } }), 1, 'ML, advisory only');
  assert.equal(tech({ systemType: 'agent', answers: { ...low(), automation: 0 } }), 3, 'an agent takes actions by design');
  assert.equal(tech({ systemType: 'biometric', answers: { ...low(), automation: 0 } }), 3);
  assert.equal(principleRisk(P({ systemType: 'genai' }), 1).robustness.items.at(-1), 3, 'version 1 rates by model family alone');
});

test('v2 uses one cut-off scale whatever laws are in scope; the administrator can change it', () => {
  assert.deepEqual([SCALE_CUTOFFS.limited, SCALE_CUTOFFS.high], [40, 65]);
  const p = P({ answers: { ...low(), impact: 2, people: 2, proxies: 1, automation: 1, explain: 1, contest: 1, inputs: 1 } });
  const a = scoreAssessment(p, ['DPDP'], [], {}); const b = scoreAssessment(p, ['EU_AI_ACT', 'GDPR'], [], {});
  assert.equal(a.inherent, b.inherent); assert.deepEqual([a.cutoffs.limited, a.cutoffs.high], [b.cutoffs.limited, b.cutoffs.high]);
  assert.equal(a.scoring, 2);
  assert.deepEqual([scaleFor({ SCALE: { limited: 30, high: 50 } }).limited, scaleFor({ SCALE: { limited: 30, high: 50 } }).high], [30, 50]);
  assert.deepEqual(scaleFor({ SCALE: { limited: 80, high: 50 } }).limited, 40, 'a malformed scale falls back to the default');
  // version 1 keeps the per-law cut-offs it was scored with
  const v1 = scoreAssessment(p, ['DPDP'], [], {}, {}, { version: 1 });
  assert.deepEqual([v1.cutoffs.limited, v1.cutoffs.high, v1.scoring], [40, 65, 1]);
  assert.deepEqual(scoreAssessment(p, ['EU_AI_ACT'], [], {}, {}, { version: 1 }).cutoffs.high, 55);
});

test('v2 control credit is earned principle by principle', () => {
  const p = P({ answers: { ...low(), impact: 2, misuse: 2, proxies: 2, people: 2 }, data: ['health'] });
  const qs = [q('a', 'privacy'), q('b', 'fairness')];
  const privOnly = scoreAssessment(p, ['GDPR'], qs, { a: 3, b: 0 });
  const both = scoreAssessment(p, ['GDPR'], qs, { a: 3, b: 3 });
  assert.equal(privOnly.principles.privacy.credit, 100); assert.equal(privOnly.principles.fairness.credit, 0);
  assert.ok(both.residual < privOnly.residual, 'strong privacy controls do not pay down fairness risk');
  assert.equal(privOnly.principles.social.credit, 0, 'no controls answered for a principle means no credit for it');
  // hand check: residual = sum of weight x risk x (1 - 0.35 x credit)
  const want = Math.round(PRINCIPLE_IDS.reduce((s, k) => s + PRINCIPLES[k].weight * both.principles[k].risk * (1 - 0.35 * both.principles[k].credit / 100), 0) / 100);
  assert.equal(both.residual, want);
});

test('v2 gives no credit to a principle with a weak critical control', () => {
  const p = P({ data: ['health'], answers: { ...low(), misuse: 2 } });
  const qs = [q('a', 'privacy', 3), q('b', 'privacy', 2), q('c', 'privacy', 2)];
  const r = scoreAssessment(p, ['GDPR'], qs, { a: 1, b: 3, c: 3 });           // critical control only "Started"
  assert.equal(r.principles.privacy.readiness, 72);                             // (3x35 + 2x100 + 2x100) / 7
  assert.equal(r.principles.privacy.credit, 0);
  assert.match(r.principles.privacy.creditNote, /critical/i);
  assert.equal(scoreAssessment(p, ['GDPR'], qs, { a: 2, b: 3, c: 3 }).principles.privacy.credit, 87);
});

test('v2 suspends control credit while a breach signal is open, and says why', () => {
  const p = P({ data: ['health'], answers: { ...low(), misuse: 2, impact: 2 } });
  const qs = PRINCIPLE_IDS.map((k) => q(k, k));
  const best = Object.fromEntries(qs.map((x) => [x.id, 3]));
  const calm = scoreAssessment(p, ['GDPR'], qs, best);
  const hot = scoreAssessment(p, ['GDPR'], qs, best, {}, { signals: [{ id: 'incident', text: 'An incident is open', suspends: true }] });
  assert.ok(calm.residual < calm.inherent);
  assert.equal(hot.residual, hot.inherent);
  assert.equal(hot.creditSuspended, true);
  assert.ok(hot.reasons.some((x) => /incident is open/i.test(x)));
  const watch = scoreAssessment(p, ['GDPR'], qs, best, {}, { signals: [{ id: 'drift', text: 'Drift', suspends: false }] });
  assert.equal(watch.residual, calm.residual, 'a watch signal is shown but does not change the score');
});

test('assessments scored before version 2 stay reproducible; new ones carry their version', () => {
  const p = P({ answers: { ...low(), impact: 3, automation: 2 }, systemType: 'genai' });
  const old = { profile: p, frameworks: ['DPDP'], questions: [], answers: {} };
  const legacy = scoreAssessment(p, ['DPDP'], [], {}, {}, { version: 1 });
  assert.equal(rescore(old).inherent, legacy.inherent);
  assert.equal(rescore(old).scoring, 1);
  assert.equal(rescore({ ...old, scoring: 2 }).scoring, 2);
  assert.notEqual(rescore({ ...old, scoring: 2 }).inherent, legacy.inherent);
  assert.equal(SCORING_VERSION, 2);
  // signals never touch a version 1 assessment
  const sig = [{ id: 'incident', text: 'x', suspends: true }];
  assert.equal(rescore(old, {}, sig).creditSuspended, undefined);
});

// ---------- legal position ----------
test('Annex I product safety components are high-risk under the EU AI Act only', () => {
  const p = P({ annexI: 'yes' });
  assert.equal(legalClass(p, ['EU_AI_ACT']).tier, 'high');
  assert.match(legalClass(p, ['EU_AI_ACT']).reason, /Annex I/);
  assert.equal(legalClass(p, ['GDPR']).tier, 'minimal');
  assert.equal(legalClass(P(), ['EU_AI_ACT']).tier, 'minimal');
  assert.equal(legalClass(P({ annexI: 'yes', annex: 'essential', narrowTask: 'yes', profiling: 'no' }), ['EU_AI_ACT']).tier, 'high', 'the Art. 6(3) exception is for Annex III only');
  assert.equal(profileFlags(p).highRisk, true);
});

test('the Annex III essential services label names emergency healthcare triage', () => {
  assert.match(ANNEX_III.find((a) => a.id === 'essential').label, /emergency healthcare patient triage/i);
});

test('EU role: stated role wins; otherwise it follows how the system is sourced', () => {
  assert.deepEqual([euRoles(P({ sourcing: 'build' })).provider, euRoles(P({ sourcing: 'build' })).deployer], [true, true]);
  assert.deepEqual([euRoles(P({ sourcing: 'vendor' })).provider, euRoles(P({ sourcing: 'vendor' })).deployer], [false, true]);
  assert.deepEqual([euRoles(P({ sourcing: 'vendor', euRole: 'provider' })).provider, euRoles(P({ sourcing: 'vendor', euRole: 'provider' })).deployer], [true, false]);
  assert.deepEqual([euRoles(P({ euRole: 'both' })).provider, euRoles(P({ euRole: 'both' })).deployer], [true, true]);
  assert.equal(euRoles(P({ euRole: 'deployer' })).label, 'Deployer');
});

test('legal position is reported law by law', () => {
  const p = P({ annex: 'essential', data: ['health', 'children'], euRole: 'deployer', answers: { ...low(), impact: 3, scale: 2, automation: 2, people: 3 } });
  const l = legalByLaw(p, ['EU_AI_ACT', 'GDPR', 'DPDP']);
  assert.equal(l.EU_AI_ACT.category, 'High-risk'); assert.equal(l.EU_AI_ACT.role, 'Deployer');
  assert.equal(l.GDPR.dpia, 'required'); assert.ok(l.GDPR.criteria.length >= 2);
  assert.equal(l.GDPR.art22, true); assert.equal(l.GDPR.special, true);
  assert.equal(l.DPDP.children, true); assert.equal(l.DPDP.sdfCheck, true);
  const calm = legalByLaw(P({ data: ['none'] }), ['EU_AI_ACT', 'GDPR', 'DPDP']);
  assert.equal(calm.EU_AI_ACT.category, 'Minimal risk'); assert.equal(calm.GDPR.dpia, 'na'); assert.equal(calm.DPDP.applies, false);
  assert.equal(legalByLaw(P({ data: ['contact'] }), ['GDPR']).GDPR.dpia, 'none');
  assert.equal(legalByLaw(P({ data: ['contact'], answers: { ...low(), scale: 2 } }), ['GDPR']).GDPR.dpia, 'screen', 'one criterion: screen and record');
  assert.equal(legalByLaw(p, ['GDPR']).EU_AI_ACT, undefined, 'only laws in scope are reported');
  assert.equal(legalByLaw(P({ prohibited: ['x'] }), ['EU_AI_ACT']).EU_AI_ACT.category, 'Prohibited');
  assert.equal(legalByLaw(P({ transparency: ['chat'] }), ['EU_AI_ACT']).EU_AI_ACT.category, 'Transparency duties');
});

// ---------- question bank ----------
test('question bank: every question asks one thing, cites only the three laws, and split questions keep their ids', () => {
  for (const x of QUESTIONS) {
    for (const k of Object.keys(x.maps)) assert.ok(['EU_AI_ACT', 'GDPR', 'DPDP', 'RAI', 'DG'].includes(k), `${x.id} maps to ${k}`);
    assert.ok(x.q.length <= 230, `${x.id} is too long (${x.q.length})`);
    assert.ok(!/\bHIPAA|NIST|ISO\/?IEC|ISO 42001|CCPA|SOX|PCI\b/i.test(`${x.q} ${x.options.join(' ')} ${x.action}`), `${x.id} cites a law outside scope`);
    assert.equal(new Set(x.options).size, 4, `${x.id} options differ`);
    if (x.kind === 'core') assert.equal(x.when, undefined, `${x.id} fixed questions have no condition`);
  }
  const ids = new Set(QUESTIONS.map((x) => x.id));
  for (const id of ['EU-C3', 'EU-C4', 'EU-C6', 'EU-C8', 'SH-C1', 'DP-C1', 'DP-C3', 'RAI-C5', 'DG-C5', 'EU-A3', 'EU-A4']) assert.ok(ids.has(id), `${id} kept`);
  for (const id of ['EU-C9', 'EU-C10', 'EU-C11', 'EU-C12', 'SH-C3', 'DP-C4', 'DP-C5', 'RAI-C7', 'DG-C7']) assert.ok(ids.has(id), `${id} added by a split`);
  const core = QUESTIONS.filter((x) => x.kind === 'core').length; const adaptive = QUESTIONS.length - core;
  assert.ok(core >= 44, `fixed ${core}`); assert.ok(adaptive >= 85, `tailored ${adaptive}`);
});

test('fixed questions that were double-barrelled now ask about one control each', () => {
  const by = Object.fromEntries(QUESTIONS.map((x) => [x.id, x]));
  assert.ok(!/log/i.test(by['EU-C3'].q)); assert.match(by['EU-C9'].q, /log/i);
  assert.ok(!/breach/i.test(by['SH-C1'].q)); assert.match(by['SH-C3'].q, /breach/i);
  assert.ok(!/consent/i.test(by['DP-C1'].q)); assert.match(by['DP-C4'].q, /consent/i);
  assert.ok(!/grievance/i.test(by['DP-C3'].q)); assert.match(by['DP-C5'].q, /grievance/i);
  assert.ok(!/incident/i.test(by['EU-C8'].q)); assert.match(by['EU-C12'].q, /incident/i);
});

test('tailored questions follow the EU role: providers and deployers get their own duties', () => {
  const hr = { annex: 'employment', domain: 'hr', answers: { ...low(), impact: 3 } };
  const ids = (o) => rankAdaptive(P({ ...hr, ...o }), ['EU_AI_ACT']).map((r) => r.q.id);
  const prov = ids({ euRole: 'provider', sourcing: 'build' }); const dep = ids({ euRole: 'deployer', sourcing: 'vendor' });
  for (const id of ['EU-A3', 'EU-A16', 'EU-A17', 'EU-A18']) { assert.ok(prov.includes(id), `provider ${id}`); assert.ok(!dep.includes(id), `deployer has no ${id}`); }
  for (const id of ['EU-A4', 'EU-A19', 'EU-A20', 'EU-A21', 'EU-A22']) { assert.ok(dep.includes(id), `deployer ${id}`); assert.ok(!prov.includes(id), `provider has no ${id}`); }
  const minimal = rankAdaptive(P({ euRole: 'provider' }), ['EU_AI_ACT']).map((r) => r.q.id);
  assert.ok(!minimal.includes('EU-A16'), 'role duties apply to high-risk systems only');
});

test('tailored questions follow the sector and the type of AI', () => {
  const ids = (o, fws = ['EU_AI_ACT', 'GDPR', 'DPDP']) => rankAdaptive(P({ answers: { ...low(), impact: 3 }, ...o }), fws).map((r) => r.q.id);
  const sectors = { credit: 'SX-CR1', insurance: 'SX-IN1', hr: 'SX-HR1', health: 'SX-HL1', education: 'SX-ED1', public: 'SX-PB1', service: 'SX-CS1', marketing: 'SX-MK1' };
  for (const [domain, id] of Object.entries(sectors)) {
    assert.ok(ids({ domain }).includes(id), `${domain} gets ${id}`);
    for (const [other, oid] of Object.entries(sectors)) if (other !== domain && !['credit', 'insurance'].includes(domain)) assert.ok(!ids({ domain }).includes(oid) || oid === id, `${domain} does not get ${oid}`);
  }
  assert.ok(ids({ systemType: 'rag' }).includes('RAI-A6'), 'generative AI gets the groundedness check');
  assert.ok(!ids({ systemType: 'ml' }).includes('RAI-A6'));
  assert.ok(ids({ systemType: 'ml' }).includes('RAI-A8'), 'predictive ML gets outcome monitoring');
  // every sector question stays inside the chosen laws, RAI and DG
  for (const x of QUESTIONS.filter((y) => y.id.startsWith('SX-'))) assert.ok(['RAI', 'DG', 'EU_AI_ACT', 'GDPR', 'DPDP'].includes(Object.keys(x.maps)[0]), x.id);
});

test('questionnaire keeps its 70-80% fixed share with the larger bank, and adds new fixed questions on re-assessment', () => {
  for (const fws of [['EU_AI_ACT'], ['GDPR'], ['DPDP'], ['EU_AI_ACT', 'GDPR', 'DPDP']]) {
    const { fixed, adaptive } = buildQuestionnaire(P({ annex: 'essential', answers: { ...low(), impact: 3 } }), fws);
    const share = adaptive.length / (fixed.length + adaptive.length);
    assert.ok(share >= 0.2 && share <= 0.3, `${fws} ${share}`);
  }
  assert.ok(fixedQuestions(P(), ['DPDP']).some((x) => x.id === 'DP-C4'));
});

// ---------- evidence ----------
test('proof can be a link with a short description; a description alone is not proof', () => {
  assert.ok(hasLink('Model card: https://wiki.example.com/cards/sepsis-v2 (section 4)'));
  assert.ok(hasLink('https://example.com/a'));
  assert.ok(!hasLink('See the model card in the wiki')); assert.ok(!hasLink('http://')); assert.ok(!hasLink('ftp://example.com/a'));
  assert.ok(evidenceMet('proof', { ref: 'DPIA v3: https://dms.example.com/dpia/3' }));
  assert.ok(!evidenceMet('proof', { ref: 'DPIA v3 in the DMS' }));
  assert.ok(evidenceMet('reference', { ref: 'DPIA v3 in the DMS' }));
  assert.equal(evidenceNeed({ weight: 2 }, 3, 'minimal'), 'proof');
});

test('the same evidence reused across many items is flagged for the reviewer', () => {
  const ev = { a: { ref: 'https://x.example.com/doc' }, b: { ref: 'see https://x.example.com/doc ' }, c: { ref: 'HTTPS://X.example.com/doc' }, d: { file: 'policy.pdf', size: 10 }, e: { file: 'policy.pdf', size: 10 }, f: { ref: 'unique note' } };
  const r = evidenceReuse(ev);
  assert.equal(r.length, 1); assert.equal(r[0].count, 3); assert.deepEqual(r[0].items, ['a', 'b', 'c']);
  assert.equal(evidenceReuse(ev, 2).length, 2);
  assert.deepEqual(evidenceReuse({}), []); assert.deepEqual(evidenceReuse(null), []);
});

test('answers that contradict the risk profile are listed for the reviewer', () => {
  const p = P({ data: ['health'], sourcing: 'vendor', answers: { ...low(), automation: 1, explain: 2, impact: 3, scale: 2 } });
  const qs = [{ id: 'GD-C1', na: 'The system uses no personal data' }, { id: 'EU-C5' }, { id: 'RAI-C6' }, { id: 'RAI-C3', na: 'The system makes no output about people' },
    { id: 'EU-C8' }, { id: 'DG-A4' }, { id: 'GD-C3', na: 'A documented screening shows a DPIA is not required' }, { id: 'SH-C2', na: 'No processor handles personal data for this system' }];
  const flags = consistencyFlags(p, ['GDPR'], qs, { 'GD-C1': 'na', 'EU-C5': 0, 'RAI-C6': 3, 'RAI-C3': 'na', 'EU-C8': 3, 'DG-A4': 0, 'GD-C3': 'na', 'SH-C2': 'na' });
  assert.deepEqual(flags.map((f) => f.id).sort(), ['dpia', 'explain', 'monitoring', 'no-people', 'oversight', 'personal', 'processor']);
  for (const f of flags) { assert.ok(f.text.length > 20); assert.ok(f.qids.length >= 1); }
  assert.deepEqual(consistencyFlags(p, ['GDPR'], qs, { 'GD-C1': 2, 'EU-C5': 2, 'RAI-C6': 1, 'RAI-C3': 2, 'EU-C8': 2, 'DG-A4': 2, 'GD-C3': 2, 'SH-C2': 2 }), []);
  assert.deepEqual(consistencyFlags(p, ['GDPR'], [], {}), []);
});

// ---------- lifecycle ----------
test('a High-risk change needs the governance lead as well as the reviewer', () => {
  assert.deepEqual(requiredApprovals(8, 'high'), ['assessor', 'lead']);
  assert.deepEqual(requiredApprovals(8, 'limited'), ['assessor']);
  for (const n of [2, 5, 6]) assert.deepEqual(requiredApprovals(n, 'high'), ['assessor', 'lead']);
  for (const n of [1, 3, 4, 7, 9, 10]) assert.deepEqual(requiredApprovals(n, 'high'), ['assessor']);
});

test('"Approved with conditions" becomes a tracked action', () => {
  const a = conditionAction(5, 'Re-run the subgroup test for ages 18 to 39 before go-live', new Date('2026-11-12T00:00:00Z'));
  assert.equal(a.source, 'condition'); assert.equal(a.stage, 5); assert.equal(a.priority, 'High'); assert.equal(a.status, 'Open');
  assert.equal(a.due, '2026-12-12'); assert.match(a.action, /subgroup test/);
  assert.equal(conditionAction(5, '   ', new Date()), null);
  const ov = conditionAction(4, 'Override: design review held offline, minutes to follow', new Date());
  assert.equal(ov.topic, 'Override follow-up (stage 4)'); assert.match(ov.action, /^Follow up the gate override at stage 4: design review held offline/);
  assert.equal(ov.source, 'condition', 'an override is followed up like a condition, so it must be closed before go-live');
});

test('go-live is blocked by open conditions and by overdue high-priority actions, not by planned ones', () => {
  const today = '2026-11-12';
  const x = { stage: 6, actions: [
    { id: '1', source: 'condition', stage: 5, status: 'Open', priority: 'High', due: '2026-12-01' },
    { id: '2', source: 'assessment', status: 'Open', priority: 'High', due: '2026-11-01' },
    { id: '3', source: 'assessment', status: 'Open', priority: 'High', due: '2026-12-01' },
    { id: '4', source: 'assessment', status: 'Open', priority: 'Medium', due: '2026-10-01' },
    { id: '5', source: 'condition', stage: 2, status: 'Done', priority: 'High', due: '2026-10-01' }] };
  const b = goLiveBlockers(x, today);
  assert.equal(b.length, 2); assert.match(b[0], /1 condition/); assert.match(b[1], /1 high-priority action/);
  assert.deepEqual(goLiveBlockers({ ...x, stage: 5 }, today), [], 'only the go-live stage is gated');
  assert.deepEqual(goLiveBlockers({ stage: 6, actions: [] }, today), []);
  // a condition set at go-live itself is followed up in production, it cannot block its own stage
  assert.deepEqual(goLiveBlockers({ stage: 6, actions: [{ source: 'condition', stage: 6, status: 'Open', priority: 'High', due: '2026-12-01' }] }, today), []);
});

test('bulk ticking never covers mandatory checks', () => {
  const st = STAGES[5];
  const items = bulkTickable(st.checklist, 'high', {});
  assert.ok(items.length < st.checklist.length);
  for (const i of items) assert.equal(isMandatory(i, 'high', {}), false, i);
  for (const i of st.checklist) if (isMandatory(i, 'high', {})) assert.ok(!items.includes(i));
});

test('breach signals: open incident, overdue high-priority actions, model version not yet approved', () => {
  const now = new Date('2026-11-12T10:00:00Z');
  const base = { stage: 7, status: 'In production', stages: {}, actions: [] };
  assert.deepEqual(breachSignals(base, now), []);
  const inc = breachSignals({ ...base, stage: 9, stages: { 9: { status: 'open' } } }, now);
  assert.deepEqual(inc.map((s) => [s.id, s.suspends]), [['incident', true]]);
  const od = breachSignals({ ...base, actions: [{ status: 'Open', priority: 'High', due: '2026-11-01' }, { status: 'Open', priority: 'High', due: '2026-12-01' }, { status: 'Done', priority: 'High', due: '2026-01-01' }] }, now);
  assert.deepEqual(od.map((s) => s.id), ['overdue']); assert.match(od[0].text, /1 high-priority action/);
  const ver = { ...base, connector: { latest: '3', alerts: [{ at: '2026-11-10T00:00:00Z', version: '3', from: '2', raised: false }] } };
  assert.deepEqual(breachSignals(ver, now).map((s) => s.id), ['version']);
  assert.deepEqual(breachSignals({ ...ver, approvedVersions: [{ version: '3', at: '2026-11-11T00:00:00Z', stage: 8 }] }, now), []);
  const drift = { ...base, connector: { monitoring: { drift: { drifted: [{ column: 'age' }] } } } };
  assert.deepEqual(breachSignals(drift, now).map((s) => [s.id, s.suspends]), [['drift', false]]);
  assert.deepEqual(breachSignals({ ...base, status: 'Active', stage: 3, actions: [{ status: 'Open', priority: 'High', due: '2026-11-01' }] }, now), [], 'signals apply to products in production');
});

test('a "new version found" alert is cleared once an approved change covers it', () => {
  const alert = { at: '2026-11-10T00:00:00Z', version: '2', from: '1', raised: true };
  assert.equal(versionCovered({ stages: {} }, alert), false);
  assert.equal(versionCovered({ approvedVersions: [{ version: '2' }] }, alert), true);
  assert.equal(versionCovered({ approvedVersions: [{ version: '1' }] }, alert), false);
  assert.equal(versionCovered({ stages: { 8: { status: 'approved', approvedAt: '2026-11-11T00:00:00Z' } } }, alert), true, 'a change approved after the alert covers it');
  assert.equal(versionCovered({ stages: { 8: { status: 'approved', approvedAt: '2026-11-09T00:00:00Z' } } }, alert), false);
  assert.equal(versionCovered({ rounds: [{ stage: 8, record: { status: 'approved', approvedAt: '2026-11-12T00:00:00Z' } }] }, alert), true);
  const x = { connector: { alerts: [alert, { kind: 'drift', at: '2026-11-10T00:00:00Z' }, { at: '2026-11-12T00:00:00Z', version: '3', from: '2', raised: false }] }, approvedVersions: [{ version: '2' }] };
  assert.deepEqual(pendingVersions(x).map((a) => a.version), ['3']);
  assert.deepEqual(approvedVersionEntry({ connector: { latest: '4' }, card: { modelVersion: '1.0' } }, 8, '2026-11-12T00:00:00Z'), { version: '4', at: '2026-11-12T00:00:00Z', stage: 8, source: 'registry' });
  assert.equal(approvedVersionEntry({ card: { modelVersion: '1.4.0' } }, 6, 'x').source, 'card');
  assert.equal(approvedVersionEntry({}, 6, 'x'), null);
  // a change approval covers the version that was under review, even if the registry has moved on since it was raised
  const moved = { connector: { latest: '5' }, events: [{ kind: 'incident' }, { kind: 'change', version: '4' }] };
  assert.equal(approvedVersionEntry(moved, 8, 'x').version, '4');
  assert.equal(approvedVersionEntry(moved, 6, 'x').version, '5', 'go-live covers the version in the registry when it is approved');
  assert.equal(approvedVersionEntry({ connector: { latest: '5' }, events: [{ kind: 'change' }] }, 8, 'x').version, '5', 'older change records carry no version');
});

test('incident reporting clocks follow the laws in scope', () => {
  const at = '2026-11-12T08:00:00.000Z';
  const all = incidentClocks({ at, severity: 'serious', seriousKind: 'general', personalData: true }, ['EU_AI_ACT', 'GDPR', 'DPDP'], { highRisk: true });
  assert.deepEqual(all.map((c) => c.law), ['EU_AI_ACT', 'GDPR', 'DPDP']);
  assert.equal(all[0].due, '2026-11-27T08:00:00.000Z');                 // 15 days
  assert.equal(all[1].due, '2026-11-15T08:00:00.000Z');                 // 72 hours
  assert.equal(all[2].due, '2026-11-15T08:00:00.000Z');
  assert.match(all[0].ref, /Art\. 73/); assert.match(all[1].ref, /Art\. 33/); assert.match(all[2].ref, /Rule 7/);
  assert.deepEqual(all.map((c) => c.period), ['15 days', '72 hours', '72 hours'], 'each clock is worded as the law words it');
  const eu = (k) => incidentClocks({ at, severity: 'serious', seriousKind: k }, ['EU_AI_ACT'], { highRisk: true })[0].due;
  assert.equal(eu('widespread'), '2026-11-14T08:00:00.000Z');           // 2 days
  assert.equal(eu('death'), '2026-11-22T08:00:00.000Z');                // 10 days
  assert.deepEqual(incidentClocks({ at, severity: 'minor', personalData: false }, ['EU_AI_ACT', 'GDPR', 'DPDP'], { highRisk: true }), []);
  assert.deepEqual(incidentClocks({ at, severity: 'serious', personalData: false }, ['EU_AI_ACT'], { highRisk: false }), [], 'Art. 73 is for high-risk systems');
  assert.deepEqual(incidentClocks({ at, severity: 'serious', personalData: true }, ['DPDP'], {}).map((c) => c.law), ['DPDP']);
  assert.deepEqual(incidentClocks({ at, severity: 'minor', personalData: true }, [], {}), []);
});

test('checks the registry can confirm are marked confirmed or not confirmed', () => {
  assert.deepEqual(registryChecks({}), {});
  const x = { card: { modelVersion: '2' }, connector: { latest: '2', versions: [{ version: '2' }, { version: '1' }], monitoring: { monitor: { status: 'ACTIVE' } } } };
  const c = registryChecks(x);
  assert.equal(c['Monitoring dashboards and alerts are live.'].ok, true);
  assert.equal(c['Approval status and production version are updated in the inventory.'].ok, true);
  assert.equal(c['Previous configuration is recoverable.'].ok, true);
  const y = registryChecks({ card: { modelVersion: '1' }, connector: { latest: '2', versions: [{ version: '2' }], monitoring: null } });
  assert.equal(y['Monitoring dashboards and alerts are live.'].ok, false);
  assert.equal(y['Approval status and production version are updated in the inventory.'].ok, false);
  assert.equal(y['Previous configuration is recoverable.'].ok, false);
  for (const k of Object.keys(c)) assert.ok(STAGES.some((s) => s.checklist.includes(k)), `${k} is a real checklist item`);
});

test('live metrics are compared with the values approved on the AI card', () => {
  const card = [{ name: 'Recall', value: '0.90' }, { name: 'Precision', value: '85%' }, { name: 'Override rate', value: '7%' }, { name: 'AUC', value: 'n/a' }];
  const r = compareMetrics(card, { recall_positive: 0.8, recall: 0.95, precision: 0.84, roc_auc: 0.9 });
  assert.deepEqual(r.map((x) => [x.name, x.approved, x.live, x.breach]), [['Recall', 0.9, 0.8, true], ['Precision', 0.85, 0.84, false]]);
  assert.deepEqual(compareMetrics([], { recall: 1 }), []); assert.deepEqual(compareMetrics(card, null), []);
});

test('controls that matter at a gate and are not yet in place are listed for that stage', () => {
  const qs = [{ id: 'EU-A11', topic: 'Fairness testing', weight: 3 }, { id: 'EU-C6', topic: 'Accuracy and robustness', weight: 2 }, { id: 'EU-C5', topic: 'Human oversight', weight: 3 },
    { id: 'EU-C8', topic: 'Production monitoring', weight: 2 }, { id: 'DG-A4', topic: 'Drift monitoring', weight: 2 }, { id: 'GD-C1', topic: 'Lawful basis', weight: 3 }, { id: 'RAI-C8', topic: 'Stop and roll back', weight: 3 }];
  const ans = { 'EU-A11': 1, 'EU-C6': 3, 'EU-C5': 0, 'EU-C8': 1, 'DG-A4': 'unknown', 'GD-C1': 0, 'RAI-C8': 2 };
  assert.deepEqual(stageControlGaps(5, qs, ans).map((g) => g.id), ['EU-A11']);
  assert.deepEqual(stageControlGaps(6, qs, ans).map((g) => g.id), ['EU-C5', 'EU-C8', 'DG-A4']);   // critical first; monitoring, drift included, must be live at go-live
  assert.deepEqual(stageControlGaps(7, qs, ans).map((g) => g.id), ['EU-C8', 'DG-A4']);
  assert.equal(stageControlGaps(6, qs, ans)[0].level, 'Not in place'); assert.equal(stageControlGaps(7, qs, ans)[1].level, 'Not known');
  assert.deepEqual(stageControlGaps(3, qs, ans), []); assert.deepEqual(stageControlGaps(6, qs, { ...ans, 'EU-C5': 2, 'EU-C8': 'na', 'DG-A4': 3 }), []);
  // a reviewer's lower rating counts
  assert.deepEqual(stageControlGaps(6, qs, { ...ans, 'EU-C5': 3, 'EU-C8': 3, 'DG-A4': 3 }, { 'EU-C5': { rating: 1 } }).map((g) => g.id), ['EU-C5']);
});
