// Operations: the governance team's view across every client. Review timers against the service level,
// reviewer workload, a portfolio row per client, and time to value.
import { useState } from 'react';
import { AlarmClock, Building2, Gauge, Loader2, RefreshCw, Timer, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ROLES } from '../data/lifecycle.js';
import { DEFAULT_SLA, reviewTimers, reviewerStats, portfolio, timeToValue, median } from '../engine/ops.js';
import { Panel, Pill, TierBadge, fmtDate } from '../components/ui.jsx';
import { toast } from '../components/Extras.jsx';
import { syncProduct } from '../components/Registry.jsx';
import { registryOpen } from '../lib/registryStage.js';
import { cloud } from '../lib/cloud.js';
import { useStore, waitingOn } from '../store/store.jsx';

const SLA_TONE = { ok: 'good', soon: 'warn', over: 'bad' };
const SLA_TEXT = { ok: 'On track', soon: 'Due soon', over: 'Overdue' };
const fmtDays = (d) => (d == null ? '—' : `${d} ${d === 1 ? 'day' : 'days'}`);

function ClientName({ c }) {
  return (
    <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      {c.brand?.logo ? <img className="client-logo-sm" src={c.brand.logo} alt="" /> : <i className="brand-dot" style={{ background: c.brand?.color || 'var(--line)' }} aria-hidden />}
      <span>{c.name}</span>
    </span>
  );
}

export default function Ops({ nav }) {
  const store = useStore();
  const { systems, state } = store;
  const sla = Number(state.settings.reviewSlaDays) || DEFAULT_SLA;
  const timers = reviewTimers(systems, { sla, waitingOn });
  const rows = portfolio(state.clients, systems, { timers });
  const people = reviewerStats(systems, state.audit);
  const ttv = timeToValue(state.clients, systems, state.users).filter((x) => x.start);
  const ttvMedian = median(ttv.map((x) => x.days));
  const over = timers.filter((t) => t.state === 'over').length;
  const connected = systems.filter((s) => s.connector?.host && registryOpen(s));
  const [checking, setChecking] = useState(false);

  const checkAll = async () => {
    setChecking(true);
    let found = 0; let failed = 0;
    for (const s of connected) {
      try { if ((await syncProduct(store, s, { quiet: true })) !== 'same') found += 1; } catch { failed += 1; }
    }
    setChecking(false);
    toast(`${connected.length} model${connected.length === 1 ? '' : 's'} checked: ${found} with a new version${failed ? `, ${failed} could not be read` : ''}`, found || failed ? 'warn' : 'good');
  };

  return (
    <div className="fade-in">
      <div className="page-head">
        <div><h1>Operations</h1><p>Every client in one place: what is waiting, what is late, who is reviewing and how fast clients get their first approval.</p></div>
        {cloud && connected.length > 0 && <button className="btn" onClick={checkAll} disabled={checking}>{checking ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Check {connected.length} connected model{connected.length === 1 ? '' : 's'}</button>}
      </div>

      <div className="kpis">
        <div className="kpi"><span className="kpi-ico"><Building2 size={18} /></span><span><span className="kpi-v num">{rows.filter((r) => r.products).length}</span><span className="kpi-l">Clients with products</span></span></div>
        <div className="kpi"><span className="kpi-ico"><Timer size={18} /></span><span><span className="kpi-v num">{timers.length}</span><span className="kpi-l">Stages waiting for review</span></span></div>
        <div className={`kpi ${over ? 'kpi-bad' : ''}`}><span className="kpi-ico"><AlarmClock size={18} /></span><span><span className="kpi-v num">{over}</span><span className="kpi-l">Past the {sla}-working-day target</span></span></div>
        <div className="kpi"><span className="kpi-ico"><Gauge size={18} /></span><span><span className="kpi-v num">{fmtDays(ttvMedian)}</span><span className="kpi-l">Median time to first approval</span></span></div>
      </div>

      <section className="section">
        <div className="section-head"><h2>Review timers</h2><span className="xs mute">Target: a decision within {sla} working days of submission. Administrators can change it in Settings.</span></div>
        <div className="panel">
          {timers.length === 0 ? <p className="small mute">Nothing is waiting for review.</p> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Product</th><th>Client</th><th>Stage</th><th>Submitted</th><th>Waiting on</th><th>Working days</th><th>Target</th></tr></thead>
              <tbody>{timers.map((t) => (
                <tr key={`${t.s.id}-${t.n}`} className="click" onClick={() => nav(`/product/${t.s.id}`)}>
                  <td><b style={{ fontWeight: 500 }}>{t.s.name}</b> <TierBadge tier={t.s.assessment.results.tier} /></td>
                  <td className="small">{state.clients.find((c) => c.id === t.s.clientId)?.name || '—'}</td>
                  <td className="num">{t.n}</td><td className="small">{fmtDate(t.at)}</td>
                  <td className="small">{t.waiting.map((r) => ROLES[r]?.name || r).join(', ') || '—'}</td>
                  <td className="num"><span className="sla-meter" aria-hidden><i className={`sla-${t.state}`} style={{ width: `${Math.min(100, (t.days / t.sla) * 100)}%` }} /></span> {t.days}</td>
                  <td><Pill tone={SLA_TONE[t.state]}>{SLA_TEXT[t.state]}</Pill></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </section>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Panel title="Clients" sub="Sorted by overdue reviews, then by what is waiting.">
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Client</th><th>Products</th><th title="Design, build and run phases">Design · build · run</th><th>High risk</th><th>Waiting</th><th>Overdue</th><th>Late actions</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.client.id}>
                <td><ClientName c={r.client} /></td><td className="num">{r.products}</td>
                <td className="num small">{r.byPhase.design} · {r.byPhase.build} · {r.byPhase.run}</td>
                <td className="num">{r.high}</td><td className="num">{r.waiting}</td>
                <td className="num">{r.overdue ? <Pill tone="bad">{r.overdue}</Pill> : 0}</td>
                <td className="num">{r.overdueActions ? <Pill tone="warn">{r.overdueActions}</Pill> : 0}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
        <Panel title={<span className="row" style={{ gap: 6 }}><Users size={15} /> Reviewer workload</span>} sub="Decisions in the last 30 days and the median working days from submission to decision.">
          {people.length === 0 ? <p className="small mute">No decisions in the last 30 days.</p> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Reviewer</th><th>Decisions</th><th>Approved</th><th>Returned</th><th>Median turnaround</th></tr></thead>
              <tbody>{people.map((p) => (
                <tr key={p.name}><td>{p.name}<div className="xs mute">{ROLES[p.role]?.name || ''}</div></td><td className="num">{p.decisions}</td><td className="num">{p.approved}</td><td className="num">{p.returned}</td>
                  <td className="num">{p.median == null ? '—' : <span className={p.median > sla ? 'tone-bad' : ''}>{fmtDays(p.median)}</span>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="xs mute" style={{ marginTop: 8 }}>Waiting now: {timers.filter((t) => t.waiting.includes('assessor')).length} for assessors, {timers.filter((t) => t.waiting.includes('lead')).length} for leads.</p>
        </Panel>
      </div>

      <section className="section">
        <div className="section-head"><h2>Time to value</h2><span className="xs mute">Days from a client's start (organisation created, first sign-up or first product) to its first approved stage.</span></div>
        <div className="grid g2">
          <div className="panel">
            {ttv.filter((x) => x.days != null).length === 0 ? <p className="small mute">No client has an approved stage yet.</p> : (
              <div style={{ height: Math.max(160, ttv.filter((x) => x.days != null).length * 38 + 40) }}>
                <ResponsiveContainer>
                  <BarChart data={ttv.filter((x) => x.days != null).map((x) => ({ name: x.client.name, Days: x.days }))} layout="vertical" margin={{ left: 10, right: 24 }}>
                    <CartesianGrid stroke="#E3E8EF" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 12, fill: '#4A5568' }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: '#4A5568' }} />
                    <Tooltip formatter={(v) => [`${v} days`, 'To first approval']} />
                    <Bar dataKey="Days" fill="var(--accent)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div className="panel">
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Client</th><th>Started</th><th>First product</th><th>First approval</th><th>Days</th></tr></thead>
              <tbody>{ttv.map((x) => (
                <tr key={x.client.id}><td>{x.client.name}</td><td className="small">{fmtDate(x.start)}</td><td className="small">{fmtDate(x.firstProduct)}</td><td className="small">{x.firstApproval ? fmtDate(x.firstApproval) : 'Not yet'}</td><td className="num">{fmtDays(x.days)}</td></tr>
              ))}</tbody>
            </table></div>
            <p className="xs mute" style={{ marginTop: 8 }}>Use the median in proposals and pilots: it is measured from real use, not estimated.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
