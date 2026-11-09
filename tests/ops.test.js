// Operations views and document packs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { workingDays, reviewTimers, reviewerStats, timeToValue, portfolio, median, slaState } from '../src/engine/ops.js';
import { annexIV, dpdpPack } from '../src/engine/docpack.js';
import { buildSeed } from '../src/store/seed.js';

test('working days skip weekends', () => {
  assert.equal(workingDays('2026-11-06T09:00:00Z', '2026-11-09T09:00:00Z'), 1);   // Fri 9:00 -> Mon 9:00
  assert.equal(workingDays('2026-11-02T00:00:00Z', '2026-11-09T00:00:00Z'), 5);
  assert.equal(workingDays('2026-11-09T00:00:00Z', '2026-11-02T00:00:00Z'), 0);
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([]), null);
  assert.equal(slaState(5.5, 5), 'over'); assert.equal(slaState(4, 5), 'soon'); assert.equal(slaState(1, 5), 'ok');
});

const sys = (id, clientId, o = {}) => ({ id, clientId, name: id, createdAt: '2026-10-01T00:00:00Z', status: 'Active', stage: 2, assessment: { results: { tier: 'high' } }, actions: [], stages: {}, ...o });

test('review timers, reviewer workload, time to value and portfolio', () => {
  const now = '2026-11-16T00:00:00Z';
  const a = sys('a', 'c1', { stages: { 1: { status: 'approved', log: [{ at: '2026-10-05T00:00:00Z', who: 'client', outcome: 'Submitted' }, { at: '2026-10-07T00:00:00Z', who: 'assessor', as: 'assessor', outcome: 'Approved' }] },
    2: { status: 'submitted', submittedAt: '2026-11-02T00:00:00Z', log: [{ at: '2026-11-02T00:00:00Z', who: 'client', outcome: 'Submitted' }] } } });
  const b = sys('b', 'c2', { stage: 1, stages: { 1: { status: 'submitted', submittedAt: '2026-11-13T00:00:00Z', log: [] } } });
  const t = reviewTimers([a, b], { sla: 5, now, waitingOn: () => ['assessor'] });
  assert.deepEqual(t.map((x) => [x.s.id, x.state]), [['a', 'over'], ['b', 'ok']]);
  const audit = [{ at: '2026-11-07T00:01:00Z', target: 'a', action: 'Stage approved', actorName: 'Ananya Rao' }];
  const r = reviewerStats([{ ...a, stages: { ...a.stages, 1: { ...a.stages[1], log: [{ at: '2026-11-05T00:00:00Z', who: 'client', outcome: 'Submitted' }, { at: '2026-11-07T00:00:00Z', who: 'assessor', as: 'assessor', outcome: 'Approved' }] } } }], audit, { now });
  assert.equal(r[0].name, 'Ananya Rao'); assert.equal(r[0].decisions, 1); assert.equal(r[0].median, 2);
  const v = timeToValue([{ id: 'c1', name: 'One', createdAt: '2026-10-01T00:00:00Z' }, { id: 'c2', name: 'Two' }], [a, b]);
  assert.equal(v[0].days, 6); assert.equal(v[1].firstApproval, null); assert.equal(v[1].start, '2026-10-01T00:00:00Z');
  const p = portfolio([{ id: 'c1', name: 'One' }, { id: 'c2', name: 'Two' }], [a, b], { timers: t, now });
  assert.equal(p[0].client.id, 'c1'); assert.equal(p[0].overdue, 1); assert.equal(p[0].high, 1);
});

test('document packs fill from product data and mark gaps', () => {
  const seed = buildSeed();
  const s = seed.systems.find((x) => x.assessment && x.stage > 3);
  const client = seed.clients.find((c) => c.id === s.clientId);
  const a = annexIV(s, { client });
  assert.equal(a.sections.length, 9);
  assert.ok(a.coverage.filled > 5 && a.coverage.filled < a.coverage.total, JSON.stringify(a.coverage));
  const purpose = a.sections[0].items[0];
  assert.ok(purpose.text.length > 20); assert.equal(purpose.ref, 'Annex IV 1(a)');
  assert.ok(a.sections.flatMap((x) => x.items).find((i) => i.label === 'Standards applied').text === '', 'standards are a gap');
  const d = dpdpPack(s, { client });
  assert.equal(d.sections.length, 2, 'no Significant Data Fiduciary part unless asked');
  assert.equal(dpdpPack(s, { client, significant: true }).sections.length, 3);
  assert.match(JSON.stringify(d), /72 hours/);
  // nothing from files or tokens leaks into documents
  const withSecrets = { ...s, connector: { kind: 'mlflow', model: 'm', host: 'https://x', tokenSealed: 'v1.SECRET', versions: [{ version: '4', metrics: { auc: 0.9 } }] } };
  const doc = JSON.stringify(annexIV(withSecrets, { client }));
  assert.doesNotMatch(doc, /SECRET/); assert.match(doc, /auc 0.9 \(registry, version 4\)/);
});

test('card completeness counts metrics read from the connected registry', async () => {
  const { cardCompleteness } = await import('../src/data/card.js');
  const base = { card: { summary: 'x' } };
  const withReg = { ...base, connector: { versions: [{ version: '3', aliases: ['champion'], metrics: { auc: 0.79 } }] } };
  assert.ok(cardCompleteness(withReg) > cardCompleteness(base));
});
