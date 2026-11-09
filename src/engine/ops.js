// Multi-client operations for the governance team: review timers against a service level, reviewer workload,
// a portfolio view per client, and time to value (days from a client's start to its first approved stage).
const DAY = 86400000;
export const DEFAULT_SLA = 5;   // working days from submission to decision
const DECIDED = ['Approved', 'Approved with conditions', 'Returned', 'Overridden'];
const APPROVED = ['Approved', 'Approved with conditions', 'Overridden'];

// Working days (Monday to Friday) from a to b, counted in whole and part days.
export function workingDays(aIso, bIso) {
  const a = new Date(aIso).getTime(); const b = new Date(bIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  // Walk calendar days (UTC), counting only the part of each weekday that falls between a and b.
  let days = 0;
  for (let t = a; t < b;) {
    const end = Math.min(b, (Math.floor(t / DAY) + 1) * DAY);
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) days += (end - t) / DAY;
    t = end;
  }
  return Math.round(days * 10) / 10;
}
export const median = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10;
};
export const slaState = (days, sla) => (days > sla ? 'over' : days >= sla * 0.8 ? 'soon' : 'ok');

// Every stage waiting for the governance team, oldest first, with its age in working days.
export function reviewTimers(systems, { sla = DEFAULT_SLA, now = new Date().toISOString(), waitingOn = () => [] } = {}) {
  const out = [];
  for (const s of systems) {
    const rec = s.stages?.[s.stage];
    if (!s.assessment || rec?.status !== 'submitted' || ['Retired', 'Draft', 'Withdrawn', 'Blocked'].includes(s.status)) continue;
    const at = rec.submittedAt || [...(rec.log || [])].reverse().find((e) => e.outcome === 'Submitted')?.at;
    if (!at) continue;
    const days = workingDays(at, now);
    out.push({ s, n: s.stage, at, days, sla, state: slaState(days, sla), waiting: waitingOn(s) });
  }
  return out.sort((a, b) => b.days - a.days);
}

// Decisions per reviewer in a period, with the median working days from submission to their decision.
// Stage logs record the role; the audit log records the person, so the two are matched by product and time.
export function reviewerStats(systems, audit, { days = 30, now = new Date().toISOString() } = {}) {
  const since = new Date(now).getTime() - days * DAY;
  const byName = new Map();
  for (const s of systems) {
    for (const rec of Object.values(s.stages || {})) {
      const log = rec.log || [];
      log.forEach((e, i) => {
        if (!DECIDED.includes(e.outcome) || new Date(e.at).getTime() < since) return;
        const sub = [...log.slice(0, i)].reverse().find((x) => x.outcome === 'Submitted');
        const t = new Date(e.at).getTime();
        const match = (audit || []).find((a) => a.target === s.id && a.actorName && Math.abs(new Date(a.at).getTime() - t) < 5 * 60000 && /^Stage|^Gate/.test(a.action || ''));
        const name = match?.actorName || ({ assessor: 'Assessors', lead: 'Leads' }[e.as || e.who] || 'Governance team');
        const row = byName.get(name) || { name, role: e.as || e.who, decisions: 0, approved: 0, returned: 0, turnaround: [] };
        row.decisions += 1;
        if (APPROVED.includes(e.outcome)) row.approved += 1; else row.returned += 1;
        if (sub) row.turnaround.push(workingDays(sub.at, e.at));
        byName.set(name, row);
      });
    }
  }
  return [...byName.values()].map((r) => ({ ...r, median: median(r.turnaround) })).sort((a, b) => b.decisions - a.decisions);
}

// First approval for a client, and how long it took from the client's start.
export function timeToValue(clients, systems, users = []) {
  return clients.map((c) => {
    const mine = systems.filter((s) => s.clientId === c.id);
    const starts = [c.createdAt, ...users.filter((u) => u.clientId === c.id).map((u) => u.createdAt), ...mine.map((s) => s.createdAt)].filter(Boolean).sort();
    const start = starts[0] || null;
    const firstProduct = mine.map((s) => s.createdAt).filter(Boolean).sort()[0] || null;
    const approvals = mine.flatMap((s) => Object.values(s.stages || {}).flatMap((r) => (r.log || []).filter((e) => APPROVED.includes(e.outcome)).map((e) => e.at))).filter(Boolean).sort();
    const first = approvals[0] || null;
    const days = start && first ? Math.max(0, Math.round(((new Date(first) - new Date(start)) / DAY) * 10) / 10) : null;
    return { client: c, start, firstProduct, firstApproval: first, days };
  });
}

// One row per client for the portfolio view.
export function portfolio(clients, systems, { timers = [], now = new Date().toISOString() } = {}) {
  return clients.map((c) => {
    const mine = systems.filter((s) => s.clientId === c.id && s.assessment && s.status !== 'Draft');
    const t = timers.filter((x) => x.s.clientId === c.id);
    const byPhase = { design: 0, build: 0, run: 0 };
    for (const s of mine) byPhase[s.stage <= 2 ? 'design' : s.stage <= 6 ? 'build' : 'run'] += 1;
    const overdueActions = mine.flatMap((s) => s.actions || []).filter((a) => a.status !== 'Done' && a.due && a.due < now.slice(0, 10)).length;
    return {
      client: c, products: mine.length, byPhase,
      high: mine.filter((s) => ['high', 'unacceptable'].includes(s.assessment.results.tier)).length,
      production: mine.filter((s) => s.status === 'In production').length,
      waiting: t.length, overdue: t.filter((x) => x.state === 'over').length, overdueActions,
    };
  }).sort((a, b) => b.overdue - a.overdue || b.waiting - a.waiting || b.products - a.products);
}
