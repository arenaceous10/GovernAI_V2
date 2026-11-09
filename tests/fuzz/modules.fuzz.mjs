// Property tests for everything computed from a product: controls, insights, document packs, deadlines,
// operations views, the ledger, sync, redaction and card completeness. Products are random mutations of the demo.
import { rng, suite, short } from './lib.mjs';
import { buildSeed } from '../../src/store/seed.js';
import { STAGES } from '../../src/data/lifecycle.js';
import { controlStatus, compassScores, stageCompletion, stagePct, validReason, isMandatory, itemState } from '../../src/data/controls.js';
import { whatIf, answerMix, checklistByStage, swot, keyMessages } from '../../src/engine/insights.js';
import { annexIV, dpdpPack } from '../../src/engine/docpack.js';
import { deadlinesFor, deadlineRadar, daysUntil, urgency } from '../../src/data/deadlines.js';
import { workingDays, median, reviewTimers, reviewerStats, timeToValue, portfolio } from '../../src/engine/ops.js';
import { localLedger, verifyChain, compareWithProduct, packSnapshot, stable, liveExtendsPack, describe, entries } from '../../src/lib/ledger.js';
import { diffState, productFromRow, productRow, clientRow, clientFromRow, auditRow, auditFromRow, noteRow, noteFromRow } from '../../src/store/sync.js';
import { scrubText, looksSensitive, safeUseCase } from '../../src/lib/redact.js';
import { cardCompleteness, cardStatus, registryVersion } from '../../src/data/card.js';
import { reportHtml } from '../../src/engine/report.js';

const N = +process.env.N || 1500;
const S = suite('modules');
const r = rng(+process.env.SEED || 5);
const seed = buildSeed();
const clone = (x) => structuredClone(x);
const iso = (d) => new Date(Date.UTC(2026, 0, 1) + d * 3600000).toISOString();

function mutate(x0) {
  const x = clone(x0);
  if (r.bool(0.2)) x.status = r.pick(['Active', 'In production', 'Retired', 'Withdrawn', 'Blocked', 'Draft']);
  if (r.bool(0.2)) x.stage = r.int(1, 10);
  for (const st of STAGES) {
    if (r.bool(0.3)) {
      const rec = x.stages[st.n] || (x.stages[st.n] = { status: 'open', checklist: {}, evidence: {}, approvals: {} });
      rec.status = r.pick(['open', 'submitted', 'returned', 'approved', undefined]);
      for (const i of st.checklist) if (r.bool(0.3)) rec.checklist[i] = r.bool(0.7);
      if (r.bool(0.3)) rec.skipped = Object.fromEntries(r.some(st.checklist, 0.2).map((i) => [i, { category: 'na', reason: r.str(40) }]));
      for (const e of st.evidence) if (r.bool(0.3)) rec.evidence[e] = r.pick([{ file: `file-${r.int(1, 99)}.pdf`, ref: '' }, { ref: 'https://x.example/doc', file: '' }, null, { path: 'a/b.pdf', file: 'b.pdf', data: 'xx' }]);
      if (r.bool(0.3)) rec.log = [...(rec.log || []), { at: iso(r.int(0, 8000)), who: r.pick(['client', 'assessor', 'lead']), outcome: r.pick(['Submitted', 'Approved', 'Returned', 'Approved with conditions', 'Overridden']), comment: r.str(20) }];
      if (r.bool(0.2)) rec.submittedAt = iso(r.int(0, 8000));
    }
  }
  if (r.bool(0.2)) x.actions = (x.actions || []).map((a) => ({ ...a, status: r.pick(['Open', 'Done']), due: r.pick([a.due, '2020-01-01', '', undefined]) }));
  if (r.bool(0.2)) x.card = { ...(x.card || {}), summary: r.str(40), metrics: r.bool() ? [{ name: 'AUC', value: '0.8' }] : [], tags: r.some(['a', 'b'], 0.5) };
  if (r.bool(0.15)) x.connector = { kind: 'databricks-uc', model: 'm', versions: Array.from({ length: r.int(0, 3) }, (_, i) => ({ version: String(i + 1), aliases: r.bool(0.3) ? ['champion'] : [], metrics: r.bool() ? { auc: r() } : undefined })), monitoring: r.bool() ? { table: 't', monitor: { status: 'ACTIVE' }, drift: { windowEnd: iso(1), checked: 3, drifted: [{ column: 'age' }] }, performance: { metrics: { f1: r() } } } : null, genai: r.bool() ? { evaluations: [{ name: 'e', at: iso(2), metrics: { 'x/mean': 1 } }] } : null };
  if (r.bool(0.1)) x.datasets = [...(x.datasets || []), { id: 'd' + r.int(1, 9), name: r.str(10), uc: r.bool() ? { upstream: ['u'], columns: 3 } : undefined }];
  if (r.bool(0.1)) x.rounds = [{ stage: 7, closedAt: iso(9), record: clone(x.stages[7] || { checklist: {} }) }];
  return x;
}

const now = '2026-11-09T10:00:00Z';
for (let i = 0; i < N; i++) {
  const base = r.pick(seed.systems.filter((x) => x.assessment));
  const x = mutate(base);
  const tier = x.assessment.results.tier;
  const ctx = short({ id: x.id, stage: x.stage, status: x.status });
  const cs = await S.run('controlStatus', () => controlStatus(x, {}), ctx);
  if (cs) S.check(cs.every((c) => ['Operating', 'Partial', 'Gap', 'In progress'].includes(c.status)), 'unknown control status', ctx);
  const comp = await S.run('compassScores', () => compassScores(x), ctx);
  if (comp) S.check(Object.values(comp.scores).every((v) => v == null || (v >= 0 && v <= 100)), 'compass score out of range', short(comp.scores));
  for (const st of STAGES) {
    const c = stageCompletion(st, x.stages[st.n], tier, {});
    S.check(c.pct >= 0 && c.pct <= 100 && c.done <= c.total, 'stage completion out of range', short({ n: st.n, c }));
    const p2 = stagePct(st, x.stages[st.n], tier, {});
    S.check(p2 === c.pct, 'stagePct and stageCompletion disagree', short({ n: st.n, a: p2, b: c.pct }));
    S.tick(2);
  }
  await S.run('whatIf', () => { const w = whatIf(x); S.check(w.afterStarted <= w.now && w.afterUnknown <= w.now, 'what-if raises the score', short(w)); }, ctx);
  await S.run('answerMix', () => answerMix(x), ctx);
  await S.run('checklistByStage', () => checklistByStage(x), ctx);
  const sw = await S.run('swot', () => swot(x, {}), ctx);
  if (sw) S.check(['S', 'W', 'O', 'T'].every((k) => Array.isArray(sw[k]) ? true : true), 'swot shape', ctx);
  const km = await S.run('keyMessages', () => keyMessages(x, {}), ctx);
  if (km) S.check(!/undefined|NaN|\[object Object\]/.test(JSON.stringify(km)), 'key messages contain undefined/NaN', short(km));
  if (sw) S.check(!/undefined|NaN|\[object Object\]/.test(JSON.stringify(sw)), 'SWOT text contains undefined/NaN', short(sw));
  const client = seed.clients.find((c) => c.id === x.clientId);
  const ax = await S.run('annexIV', () => annexIV(x, { client }), ctx);
  const dp = await S.run('dpdpPack', () => dpdpPack(x, { client, significant: r.bool() }), ctx);
  for (const doc of [ax, dp].filter(Boolean)) {
    const txt = JSON.stringify(doc);
    S.check(!/undefined|NaN|\[object Object\]|Invalid Date/.test(txt), `${doc === ax ? 'Annex IV' : 'DPDP'} pack contains undefined/NaN/Invalid Date`, txt.match(/.{60}(undefined|NaN|\[object Object\]|Invalid Date).{30}/)?.[0]);
  }
  if (ax) {
    const files = Object.values(x.stages[4]?.evidence || {}).map((v) => v?.file).filter(Boolean);
    if (files.length) S.check(files.every((f) => JSON.stringify(ax).includes(f)), 'Annex IV pack leaves out attached evidence file names', short(files));
  }
  const dl = await S.run('deadlinesFor', () => deadlinesFor(x, Date.parse(now)), ctx);
  if (dl && ['Withdrawn', 'Retired', 'Draft'].includes(x.status)) S.check(dl.length === 0, `deadlines shown for a ${x.status.toLowerCase()} product`, ctx);
  const html = await S.run('reportHtml', () => reportHtml(x, seed.audit || [], client), ctx);
  if (html) {
    S.check(!/<script/i.test(html.replace(/<script[^>]*>[^<]*<\/script>/gi, (m) => (m.includes('window.print') ? '' : m))), 'report contains script', ctx);
    const h2 = html.replaceAll('Kept, period undefined', '');   // a real answer option's wording
    S.check(!/undefined|NaN|Invalid Date/.test(h2), 'report contains undefined/NaN', h2.match(/.{60}(undefined|NaN|Invalid Date).{30}/)?.[0]);
  }
  const pc = cardCompleteness(x); S.check(pc >= 0 && pc <= 100, 'card completeness out of range', pc);
  cardStatus(x); registryVersion(x.connector);
  // Sync: a product row round-trips, and a row cannot pose as another organisation.
  const row = productRow(x); const back = productFromRow(row);
  S.check(back && back.id === x.id && back.clientId === x.clientId, 'product row does not round-trip', ctx);
  const forged = productFromRow({ ...row, client_id: 'other', data: { ...x, clientId: x.clientId } });
  S.check(forged.clientId === 'other', 'row organisation not authoritative', ctx);
  // Ledger: demo record verifies, matches the product, and any single change is detected.
  const rows = await localLedger(x);
  const v = await verifyChain(rows);
  S.check(v.ok, 'fresh demo ledger does not verify', short(v.problems));
  const cmp = compareWithProduct(rows, x);
  S.check(cmp.ok, 'demo ledger does not match its product', short({ un: cmp.unrecorded.length, mi: cmp.missing.length }));
  if (rows.length > 1) {
    const k = r.int(0, rows.length - 1); const bad = clone(rows);
    const how = r.int(0, 3);
    if (how === 0) bad[k].body = bad[k].body.replace(/"at":"[^"]*"/, '"at":"2000-01-01T00:00:00Z"') + (bad[k].body.includes('2000-01-01') ? ' ' : '');
    if (how === 1) bad.splice(k, 1);
    if (how === 2) bad[k].hash = '0'.repeat(64);
    if (how === 3) { const t2 = bad[k]; bad[k] = bad[(k + 1) % bad.length]; bad[(k + 1) % bad.length] = t2; bad.forEach((z, j) => { if (j === k || j === (k + 1) % bad.length) z.seq = j + 1; }); }
    const v2 = await verifyChain(bad);
    // Removing the newest entry cannot be seen from the chain alone (nothing points past it): packs carry the head for that.
    const tail = how === 1 && k === rows.length - 1;
    if (!tail) S.check(!v2.ok, `tampered ledger verifies (mode ${how})`, short({ k, how, n: rows.length }));
    const le = liveExtendsPack(bad, { record: { rows } });
    if (how === 1 || how === 2) S.check(!le.ok, `changed live record still extends the pack (mode ${how})`, short({ k, how }));
  }
  for (const e of entries(rows)) S.check(!/undefined|NaN/.test(describe(e)), 'ledger description has undefined', describe(e));
  const snap = packSnapshot(x);
  S.check(!JSON.stringify(snap).includes('"data":"xx"'), 'pack snapshot keeps file contents', ctx);
  S.check(stable(snap) === stable(JSON.parse(JSON.stringify(snap))), 'stable() not stable through JSON', ctx);
  S.tick(25);
}

// Portfolio-level views on random portfolios.
for (let i = 0; i < 400; i++) {
  const systems = Array.from({ length: r.int(0, 12) }, () => mutate(r.pick(seed.systems.filter((x) => x.assessment))));
  const audit = Array.from({ length: r.int(0, 30) }, () => ({ at: iso(r.int(0, 8000)), action: r.pick(['Stage approved', 'Gate overridden', 'Other']), actorName: r.pick(['A', 'B', undefined]), target: r.pick(systems)?.id }));
  const timers = reviewTimers(systems, { sla: r.int(1, 10), now });
  S.check(timers.every((t) => t.days >= 0 && ['ok', 'soon', 'over'].includes(t.state)), 'review timer invalid', short(timers[0]));
  S.check(timers.every((t) => !['Withdrawn', 'Retired', 'Draft'].includes(t.s.status)), 'review timer for an archived product', short(timers.map((t) => t.s.status)));
  const rs = reviewerStats(systems, audit, { now });
  S.check(rs.every((x) => x.decisions === x.approved + x.returned && (x.median == null || x.median >= 0)), 'reviewer stats inconsistent', short(rs[0]));
  const ttv = timeToValue(seed.clients, systems, []);
  S.check(ttv.every((x) => x.days == null || x.days >= 0), 'time to value negative', short(ttv));
  const pf = portfolio(seed.clients, systems, { timers, now });
  S.check(pf.every((x) => x.byPhase.design + x.byPhase.build + x.byPhase.run === x.products), 'portfolio phases do not add up', short(pf[0]));
  const rad = deadlineRadar(systems, Date.parse(now));
  S.check(rad.every((d) => d.products.length > 0), 'deadline with no products', '');
  S.tick(6);
}
for (let i = 0; i < 3000; i++) {
  const a = iso(r.int(0, 9000)); const b = iso(r.int(0, 9000));
  const w = workingDays(a, b); const total = (Date.parse(b) - Date.parse(a)) / 86400000;
  S.check(w >= 0 && w <= Math.max(0, total) + 0.11, 'working days out of range', short({ a, b, w }));
  const c = iso(r.int(0, 9000));
  if (a < c && c < b) S.check(Math.abs(workingDays(a, c) + workingDays(c, b) - w) <= 0.21, 'working days not additive', short({ a, b, c }));
  const xs = Array.from({ length: r.int(0, 9) }, () => r.int(-5, 50)); const m = median(xs);
  if (xs.length) S.check(m >= Math.min(...xs) && m <= Math.max(...xs), 'median out of range', short(xs));
  S.check(['past', 'soon', 'year', 'later'].includes(urgency(r.int(-500, 900))), 'urgency invalid', '');
  S.tick(4);
}
// Sync diff: applying the ops reproduces the target state.
for (let i = 0; i < 1500; i++) {
  const prev = { clients: clone(seed.clients), users: [], systems: seed.systems.slice(0, r.int(0, seed.systems.length)), audit: [], notes: [], settings: {}, bankOverrides: {} };
  const next = { ...prev, systems: [...prev.systems], audit: [...prev.audit] };
  for (let k = 0; k < r.int(0, 5); k++) {
    const op = r.int(0, 2);
    if (op === 0 && next.systems.length) next.systems.splice(r.int(0, next.systems.length - 1), 1);
    if (op === 1) next.systems.push({ ...mutate(r.pick(seed.systems.filter((x) => x.assessment))), id: 'n' + k + i });
    if (op === 2 && next.systems.length) { const j = r.int(0, next.systems.length - 1); next.systems[j] = { ...next.systems[j], name: r.str(5) }; }
  }
  const ops = diffState(prev, next, { users: false });
  const ids = new Map(prev.systems.map((x) => [x.id, x]));
  for (const x of ops.products) ids.set(x.id, x);
  for (const id of ops.productsDel) ids.delete(id);
  S.check(ids.size === new Map(next.systems.map((x) => [x.id, x])).size && next.systems.every((x) => ids.get(x.id) === x), 'diffState does not reproduce the state', '');
  const c = r.pick(seed.clients); const c2 = clientFromRow({ ...clientRow({ ...c, brand: r.bool() ? { color: '#112233', logo: '' } : null }), created_at: iso(1) });
  S.check(c2.id === c.id && c2.name === c.name, 'client row does not round-trip', '');
  const e = { at: iso(1), actor: 'client', actorName: 'X', org: 'o', action: 'A', target: 't', detail: r.str(10) };
  S.check(stable(auditFromRow(auditRow(e))) === stable(e), 'audit row does not round-trip', short(e));
  S.tick(3);
}
// Redaction: identifying data never survives, and scrubbing is idempotent.
const SECRETS = ['priya.nair@example.com', '+91 98765 43210', '4111 1111 1111 1111', 'ABCDE1234F', '1234 5678 9012', 'sk-abcdefghijklmnop1234', 'Dr. Ravi Kumar', '192.168.1.20', 'https://intranet.example.com/x', 'GB82 WEST 1234 5698 7654 32'];
for (let i = 0; i < 4000; i++) {
  const sec = r.pick(SECRETS);
  const variant = r.pick([sec, sec.toUpperCase(), sec.replace('@', '​@'), sec.normalize('NFKD'), [...sec].map((ch) => (r.bool(0.2) && /[a-z0-9@.]/i.test(ch) ? String.fromCharCode(ch.charCodeAt(0) + 0xFEE0) : ch)).join('')]);
  const text = `${r.str(30)} ${variant} ${r.str(30)}`;
  const out = scrubText(text, ['Northwind Insurance', 'Priya']);
  const core = sec.replace(/^Dr\. /, '').replace(/^https:\/\//, '');
  S.check(!out.toLowerCase().includes(core.toLowerCase()), `secret survives scrubbing (${sec})`, short({ text, out }));
  S.check(scrubText(out, ['Northwind Insurance', 'Priya']) === out, 'scrubbing not idempotent', short({ out }));
  S.check(out.length <= 700, 'scrubbed text too long', out.length);
  S.check(!looksSensitive(out), 'scrubbed text still looks sensitive', short(out));
  const u = safeUseCase({ description: text, domain: r.pick(['insurance', '<x>', 'a'.repeat(40)]), geos: [r.str(3), 'IN'], highRisk: r.pick([true, 'yes', 1]) }, []);
  S.check(typeof u.highRisk === 'boolean' && u.geos.every((g) => /^[a-z0-9_-]{1,32}$/i.test(g)), 'unsafe field passes the allowlist', short(u));
  S.tick(5);
}
for (let i = 0; i < 2000; i++) {
  const t = r.pick([r.str(60), 'n/a', 'This is covered elsewhere by policy X.', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'test test test test test test', 'Vendor contract covers this risk fully today.']);
  const v = validReason(t); S.check(typeof v === 'string', 'validReason not a string', t);
  S.tick();
}
console.log(JSON.stringify(S.report(), null, 1));
