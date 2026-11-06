// Not known answers, checklist rules and skips, controls, Compass, SWOT, AI cards, deck and LLM redaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuestionnaire, scoreAssessment, buildActions, emptyProfile, profileRating, aiPayload, UNKNOWN } from '../src/engine/engine.js';
import { PROFILE_QUESTIONS } from '../src/data/frameworks.js';
import { STAGES } from '../src/data/lifecycle.js';
import { CONTROLS, controlFor, isMandatory, validReason, controlStatus, compassScores, COMPASS_IDS } from '../src/data/controls.js';
import { swot, whatIf, keyMessages } from '../src/engine/insights.js';
import { cardCompleteness, cardStatus } from '../src/data/card.js';
import { scrubText, safeUseCase, looksSensitive } from '../src/lib/redact.js';
import { buildSeed } from '../src/store/seed.js';
import { buildDeck } from '../src/engine/deck.js';

const prof = (answers) => ({ ...emptyProfile(), name: 'Claims bot', owner: 'Priya Nair', bu: 'Claims', domain: 'insurance', systemType: 'ml', sourcing: 'build', geos: ['IN'], data: ['contact'],
  description: 'Routes claims', answers: Object.fromEntries(PROFILE_QUESTIONS.map((q) => [q.id, 0])), ...answers });

test('"Not known" on a risk profile question scores as its highest rating', () => {
  for (const q of PROFILE_QUESTIONS) {
    const p = prof({ answers: { ...prof().answers, [q.id]: UNKNOWN } });
    assert.equal(profileRating(q.id, p), Math.max(...q.options.map((o) => o.rating)), q.id);
  }
});

test('"Not known" can never make a product look safer, and raises find-out actions', () => {
  const p = prof();
  const { fixed, adaptive } = buildQuestionnaire(p, ['DPDP']);
  const qs = [...fixed, ...adaptive];
  const good = Object.fromEntries(qs.map((q) => [q.id, 3]));
  const withUnknown = { ...good, [qs[0].id]: UNKNOWN };
  const r1 = scoreAssessment(p, ['DPDP'], qs, good); const r2 = scoreAssessment(p, ['DPDP'], qs, withUnknown);
  assert.ok(r2.readiness < r1.readiness && r2.residual >= r1.residual);
  assert.deepEqual(r2.unknownControls, [qs[0].id]);
  assert.equal(r2.unanswered, 0);
  const pu = prof({ answers: { ...p.answers, impact: UNKNOWN } });
  const r3 = scoreAssessment(pu, ['DPDP'], qs, good);
  assert.ok(r3.inherent >= r1.inherent);
  const acts = buildActions(qs, withUnknown, r2.tier, new Date(), pu);
  assert.ok(acts.some((a) => a.qid === qs[0].id && a.source === 'unknown' && /Find out/.test(a.action)));
  assert.ok(acts.some((a) => a.qid === 'profile:impact' && a.priority === 'High'));
});

test('every checklist item maps to a named control, and mandatory items cover the core controls', () => {
  for (const st of STAGES) for (const item of st.checklist) {
    const c = controlFor(item);
    assert.ok(c && c.id !== 'GOV-00', `${item} has no specific control`);
    assert.ok(COMPASS_IDS.includes(c.compass));
  }
  assert.equal(new Set(CONTROLS.map((c) => c.id)).size, CONTROLS.length);
  assert.ok(isMandatory('Rollback, isolation and kill-switch procedures are tested.', 'minimal'));
  assert.ok(!isMandatory('Accessibility and inclusive design requirements are implemented.', 'high'));
  assert.ok(!isMandatory('Human oversight is staffed and operational.', 'minimal'));
  assert.ok(isMandatory('Human oversight is staffed and operational.', 'high'));
  // administrator rules win
  assert.ok(!isMandatory('Rollback, isolation and kill-switch procedures are tested.', 'high', { 'Rollback, isolation and kill-switch procedures are tested.': 'optional' }));
  assert.ok(isMandatory('Accessibility and inclusive design requirements are implemented.', 'minimal', { 'Accessibility and inclusive design requirements are implemented.': 'mandatory' }));
});

test('skip reasons must explain something', () => {
  for (const bad of ['', 'n/a', 'na', 'skip this', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'TBD', 'later later later later', 'not needed now']) assert.ok(validReason(bad), bad);
  assert.equal(validReason('Covered by the group access review that security runs every quarter.'), '');
});

test('controls, Compass and SWOT are computed for every demo product', () => {
  const seed = buildSeed();
  for (const s of seed.systems) {
    const ctl = controlStatus(s);
    assert.ok(ctl.length > 0 && ctl.every((c) => ['Operating', 'In progress', 'Partial', 'Gap'].includes(c.status)));
    const { scores, phases } = compassScores(s);
    for (const k of COMPASS_IDS) assert.ok(scores[k] == null || (scores[k] >= 0 && scores[k] <= 100), `${s.name} ${k}`);
    assert.equal(Object.keys(phases).length, 4);
    const sw = swot(s);
    for (const k of ['strengths', 'weaknesses', 'opportunities', 'threats']) assert.ok(sw[k].length >= 1 && sw[k].length <= 5);
    const w = whatIf(s); assert.ok(w.afterStarted <= w.now && w.afterUnknown <= w.now);
    assert.equal(keyMessages(s).length, 5);
    const pc = cardCompleteness(s); assert.ok(pc >= 0 && pc <= 100);
    assert.ok(cardStatus(s).label);
  }
  const demo = seed.systems[0];
  assert.equal(cardCompleteness(demo), 100);
  assert.ok(controlStatus(demo).some((c) => c.status === 'Gap' && c.control.id === 'ACC-01'));
});

test('the dashboard deck builds for every demo product', async () => {
  const seed = buildSeed();
  for (const s of seed.systems) {
    const deck = await buildDeck(s, { client: seed.clients.find((c) => c.id === s.clientId) });
    assert.equal(deck.slides.length, 11, s.name);
  }
});

test('the AI never receives names, contact details, identifiers or secrets', () => {
  const p = prof({ description: 'Built for Acme Insure by Priya Nair (priya.nair@acme.com, +91 98300 12345). Policy 4455667788, PAN ABCPE1234F, Aadhaar 1234 5678 9012, card 4111 1111 1111 1111, see https://wiki.acme.com/x, key sk-abcdef1234567890xyz, Dr. Ravi Kumar approves. Serves 100,000 customers in 2026.' });
  const body = aiPayload(p, ['DPDP'], 5, [{ q: 'Is there a named owner?' }], ['Acme Insure']);
  const text = JSON.stringify(body);
  for (const leak of ['Claims bot', 'Priya', 'Nair', 'Acme', 'acme.com', '98300', '4455667788', 'ABCPE1234F', '1234 5678', '4111', 'wiki', 'sk-abc', 'Ravi', 'Claims"']) assert.ok(!text.includes(leak), `leaked ${leak}: ${text}`);
  assert.ok(text.includes('100,000 customers in 2026'), 'ordinary facts survive');
  assert.deepEqual(Object.keys(body.useCase).sort(), ['data', 'decisions', 'description', 'domain', 'fullyAutomated', 'geos', 'highRisk', 'sourcing', 'systemType', 'transparency']);
  assert.ok(!looksSensitive(body.useCase.description));
  // the server rebuilds from the allowlist: extra fields and odd values are dropped
  const s = safeUseCase({ name: 'Secret', owner: 'Bob', email: 'a@b.co', domain: 'insurance', geos: ['IN', '<script>'], highRisk: 'yes', description: 'call 020 7946 0958' });
  assert.equal(s.name, undefined); assert.equal(s.owner, undefined); assert.deepEqual(s.geos, ['IN']); assert.equal(s.highRisk, false);
  assert.ok(!/7946/.test(s.description));
  assert.equal(scrubText('Mr. John Smith wrote this'), '[person] wrote this');
});
