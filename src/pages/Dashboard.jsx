import { AlertTriangle, ArrowRight, Boxes, CheckCircle2, ClipboardCheck, Clock, CornerDownLeft, FilePlus2, Gauge, History, Library, Rocket, Settings, ShieldAlert, Users } from 'lucide-react';
import { TIERS, TIER_ORDER } from '../data/frameworks.js';
import { QUESTIONS } from '../data/questionBank.js';
import { STAGES, PHASES, phaseOf, ROLES, requiredApprovals } from '../data/lifecycle.js';
import { Panel, TierBadge, StatusPill, fmtDate } from '../components/ui.jsx';
import { StageMini, Ring, stageLabel } from '../components/Stages.jsx';
import { useStore, waitingOn, CAN } from '../store/store.jsx';

const today = () => new Date().toISOString().slice(0, 10);
const daysSince = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : 0);
const live = (systems) => systems.filter((s) => s.status !== 'Draft' && s.assessment && s.status !== 'Retired');
const progress = (s) => {
  const st = STAGES[s.stage - 1]; const rec = s.stages?.[s.stage] || { checklist: {}, evidence: {} };
  return { done: st.checklist.filter((i) => rec.checklist[i]).length + st.evidence.filter((i) => rec.evidence[i]).length, total: st.checklist.length + st.evidence.length };
};
const waitsFor = (s, role) => { const w = waitingOn(s); return w.includes(role) || (role === 'lead' && w.includes('assessor')); };
const overdue = (s) => s.stage === 7 && s.nextReview && s.nextReview < today();

// What needs this role now (also used by tests and other pages).
export function attention(systems, role) {
  const out = [];
  for (const s of systems) {
    const rec = s.stages?.[s.stage];
    if (s.status === 'Draft') { if (role === 'client') out.push({ s, text: 'Draft: finish registration', to: `/draft/${s.id}` }); continue; }
    if (['Blocked', 'Retired'].includes(s.status)) continue;
    if (role === 'client') {
      if (rec?.status === 'returned') out.push({ s, text: `Stage ${s.stage} returned: ${rec.returnNote}`, urgent: true });
      else if (rec?.status === 'open') out.push({ s, text: `Complete stage ${s.stage}: ${STAGES[s.stage - 1].short}` });
    } else if (CAN.review(role) && waitsFor(s, role)) out.push({ s, text: `Review stage ${s.stage}: ${STAGES[s.stage - 1].short}`, urgent: waitingOn(s).includes(role) });
    if (overdue(s) && role !== 'admin') out.push({ s, text: 'Periodic review overdue' });
  }
  return out.sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent));
}

function Kpi({ icon: Icon, value, label, tone, onClick }) {
  return (
    <button type="button" className={`kpi ${tone ? `kpi-${tone}` : ''}`} onClick={onClick} disabled={!onClick}>
      <span className="kpi-ico"><Icon size={18} /></span>
      <span><span className="kpi-v num">{value}</span><span className="kpi-l">{label}</span></span>
    </button>
  );
}

// Products by lifecycle phase. Cards show stage and status; click opens the product.
function PipelineBoard({ systems, nav, showClient, highlight }) {
  const { state } = useStore();
  const cname = (id) => state.clients.find((c) => c.id === id)?.name || '';
  const list = live(systems).concat(systems.filter((s) => s.status === 'Retired'));
  return (
    <div className="board">
      {PHASES.map((ph) => {
        const items = list.filter((s) => (s.status === 'Retired' ? ph.id === 'retire' : phaseOf(s.stage).id === ph.id)).sort((a, b) => a.stage - b.stage);
        return (
          <div key={ph.id} className="board-col">
            <div className="board-head"><b>{ph.name}</b><span className="xs mute">{ph.stages.length > 1 ? 'Stages' : 'Stage'} {ph.stages[0]}{ph.stages.length > 1 ? `–${ph.stages[ph.stages.length - 1]}` : ''}</span><span className="count-chip num">{items.length}</span></div>
            <div className="board-list">
              {items.length === 0 && <div className="board-empty">None</div>}
              {items.map((s, i) => {
                const label = stageLabel(s); const hot = highlight?.(s);
                return (
                  <button key={s.id} type="button" className={`board-card ${hot ? 'hot' : ''}`} style={{ animationDelay: `${i * 40}ms` }} onClick={() => nav(`/product/${s.id}`)}>
                    <div className="spread" style={{ alignItems: 'flex-start' }}>
                      <b className="bc-name">{s.name}</b><TierBadge tier={s.assessment.results.tier} />
                    </div>
                    {showClient && <div className="xs mute">{cname(s.clientId)}</div>}
                    <div className="bc-foot"><span className="stage-chip sm">{s.stage}</span><span className="xs">{STAGES[s.stage - 1].short}</span><StatusPill status={label} /></div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReviewList({ systems, role, nav, empty }) {
  const { state } = useStore();
  const cname = (id) => state.clients.find((c) => c.id === id)?.name || '';
  const rows = systems.filter((s) => waitsFor(s, role)).sort((a, b) => (a.stages[a.stage].submittedAt || '').localeCompare(b.stages[b.stage].submittedAt || ''));
  if (!rows.length) return <div className="empty-sm"><CheckCircle2 size={22} /> {empty}</div>;
  return (
    <div className="worklist">
      {rows.map((s, i) => {
        const rec = s.stages[s.stage]; const age = daysSince(rec.submittedAt); const p = progress(s);
        const gate = requiredApprovals(s.stage, s.assessment.results.tier).includes('lead');
        return (
          <button key={s.id} type="button" className="work-item" style={{ animationDelay: `${i * 50}ms` }} onClick={() => nav(`/product/${s.id}`)}>
            <span className="stage-chip">{s.stage}</span>
            <span className="wi-main">
              <b>{s.name}</b>
              <span className="xs mute">{cname(s.clientId)} · {STAGES[s.stage - 1].name}{gate ? ' · gate, lead sign-off' : ''}</span>
            </span>
            <TierBadge tier={s.assessment.results.tier} />
            <span className="xs mute num wi-ev">{p.done}/{p.total} done</span>
            <span className={`age ${age > 5 ? 'old' : age > 2 ? 'mid' : ''}`}>{age === 0 ? 'Today' : `${age}d`}</span>
            <span className="wi-go">Review <ArrowRight size={14} /></span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------- client ----------------
function ClientHome({ nav }) {
  const { systems, client } = useStore();
  const mine = live(systems);
  const drafts = systems.filter((s) => s.status === 'Draft');
  const work = mine.filter((s) => s.status !== 'Blocked' && ['open', 'returned'].includes(s.stages?.[s.stage]?.status));
  const withTeam = mine.filter((s) => s.stages?.[s.stage]?.status === 'submitted');
  const prod = mine.filter((s) => s.stage >= 7);
  const returned = work.filter((s) => s.stages[s.stage].status === 'returned');
  const next = [...returned, ...work.filter((s) => s.stages[s.stage].status !== 'returned')];
  return (
    <div className="fade-in">
      <div className="page-head">
        <div><div className="eyebrow">{client?.name}</div><h1>Your AI lifecycle</h1></div>
        <button className="btn primary" onClick={() => nav('/new')}><FilePlus2 size={16} /> Register an AI product</button>
      </div>
      <div className="kpis">
        <Kpi icon={ClipboardCheck} value={work.length + drafts.length} label="Need your action" tone={work.length + drafts.length ? 'accent' : ''} />
        <Kpi icon={CornerDownLeft} value={returned.length} label="Returned to you" tone={returned.length ? 'warn' : ''} />
        <Kpi icon={Clock} value={withTeam.length} label="With the governance team" />
        <Kpi icon={Rocket} value={prod.length} label="In production" tone="good" onClick={() => nav('/products')} />
      </div>

      <section className="section">
        <div className="section-head"><h2>Your next steps</h2><span className="xs mute">Most urgent first</span></div>
        {next.length + drafts.length === 0 ? <div className="panel empty-sm"><CheckCircle2 size={22} /> You're up to date. The governance team has everything it needs.</div> : (
          <div className="next-grid">
            {next.map((s, i) => {
              const rec = s.stages[s.stage]; const p = progress(s); const ret = rec.status === 'returned';
              return (
                <button key={s.id} type="button" className={`next-card ${ret ? 'ret' : ''}`} style={{ animationDelay: `${i * 60}ms` }} onClick={() => nav(`/product/${s.id}`)}>
                  <div className="spread" style={{ alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="eyebrow">{ret ? 'Returned, action needed' : `Stage ${s.stage} of 10`}</div>
                      <b className="nc-name">{s.name}</b>
                      <div className="small mute">{STAGES[s.stage - 1].name}</div>
                    </div>
                    <Ring done={p.done} total={p.total} size={50} />
                  </div>
                  {ret && rec.returnNote && <div className="nc-note">{rec.returnNote}</div>}
                  <div className="nc-foot"><StageMini s={s} /><span className="nc-go">{ret ? 'Fix and resubmit' : 'Continue'} <ArrowRight size={14} /></span></div>
                </button>
              );
            })}
            {drafts.map((d) => (
              <button key={d.id} type="button" className="next-card draft" onClick={() => nav(`/draft/${d.id}`)}>
                <div className="eyebrow">Draft</div><b className="nc-name">{d.name || 'Untitled product'}</b>
                <div className="small mute">Saved {fmtDate(d.updatedAt)}. Finish registration to start the lifecycle.</div>
                <div className="nc-foot"><span /><span className="nc-go">Finish registration <ArrowRight size={14} /></span></div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2>Where your products are</h2><button className="btn ghost sm" onClick={() => nav('/products')}>All products <ArrowRight size={14} /></button></div>
        <PipelineBoard systems={systems} nav={nav} highlight={(s) => ['open', 'returned'].includes(s.stages?.[s.stage]?.status) && s.status === 'Active'} />
      </section>
    </div>
  );
}

// ---------------- reviewer ----------------
function ReviewerHome({ nav }) {
  const { systems, role } = useStore();
  const all = live(systems);
  const mineN = all.filter((s) => waitsFor(s, role));
  const oldest = mineN.reduce((m, s) => Math.max(m, daysSince(s.stages[s.stage].submittedAt)), 0);
  const returned = all.filter((s) => s.stages?.[s.stage]?.status === 'returned');
  const due = all.filter(overdue);
  return (
    <div className="fade-in">
      <div className="page-head"><div><div className="eyebrow">Governance team</div><h1>Review workspace</h1></div></div>
      <div className="kpis">
        <Kpi icon={ClipboardCheck} value={mineN.length} label="Waiting for your review" tone={mineN.length ? 'accent' : ''} onClick={() => nav('/queue')} />
        <Kpi icon={Clock} value={mineN.length ? `${oldest}d` : '—'} label="Oldest waiting" tone={oldest > 5 ? 'bad' : oldest > 2 ? 'warn' : ''} />
        <Kpi icon={CornerDownLeft} value={returned.length} label="Returned to clients" />
        <Kpi icon={AlertTriangle} value={due.length} label="Periodic reviews overdue" tone={due.length ? 'bad' : ''} />
      </div>
      <section className="section">
        <div className="section-head"><h2>Waiting for your review</h2><span className="xs mute">Oldest first</span></div>
        <ReviewList systems={all} role={role} nav={nav} empty="Nothing waiting for you. New submissions appear here." />
      </section>
      <section className="section">
        <div className="section-head"><h2>Lifecycle pipeline</h2><span className="xs mute">All clients</span></div>
        <PipelineBoard systems={systems} nav={nav} showClient highlight={(s) => waitsFor(s, role)} />
      </section>
    </div>
  );
}

// ---------------- lead ----------------
function LeadHome({ nav }) {
  const { systems, role } = useStore();
  const all = live(systems);
  const gateMine = all.filter((s) => waitingOn(s).includes('lead'));
  const reviewers = all.filter((s) => waitingOn(s).includes('assessor'));
  const high = all.filter((s) => ['high', 'unacceptable'].includes(s.assessment.results.tier));
  const due = all.filter(overdue);
  const matrix = TIER_ORDER.map((t) => ({ t, cells: PHASES.map((ph) => all.filter((s) => s.assessment.results.tier === t && phaseOf(s.stage).id === ph.id).length) }));
  const max = Math.max(1, ...matrix.flatMap((r) => r.cells));
  return (
    <div className="fade-in">
      <div className="page-head"><div><div className="eyebrow">Governance team</div><h1>Portfolio oversight</h1></div></div>
      <div className="kpis">
        <Kpi icon={ShieldAlert} value={gateMine.length} label="Gate decisions for you" tone={gateMine.length ? 'accent' : ''} onClick={() => nav('/queue')} />
        <Kpi icon={ClipboardCheck} value={reviewers.length} label="With reviewers" />
        <Kpi icon={Gauge} value={high.length} label="High or prohibited risk" tone={high.length ? 'bad' : ''} />
        <Kpi icon={AlertTriangle} value={due.length} label="Periodic reviews overdue" tone={due.length ? 'bad' : ''} />
      </div>
      <div className="grid g-wide section">
        <Panel title="Decisions waiting for you" sub="Gate stages for high-risk products need your sign-off. You can also sign in a reviewer's place.">
          <ReviewList systems={all} role={role} nav={nav} empty="No decisions waiting." />
        </Panel>
        <Panel title="Risk by lifecycle phase" sub="Live products">
          <div className="heat" style={{ gridTemplateColumns: `118px repeat(${PHASES.length}, minmax(0, 1fr))` }}>
            <span />{PHASES.map((ph) => <span key={ph.id} className="heat-h">{ph.name}</span>)}
            {matrix.map((r) => [
              <span key={r.t} className="heat-r"><TierBadge tier={r.t} /></span>,
              ...r.cells.map((n, i) => <span key={`${r.t}${i}`} className="heat-c" style={{ background: n ? `color-mix(in srgb, ${TIERS[r.t].color} ${18 + (n / max) * 55}%, white)` : undefined }}>{n || ''}</span>),
            ])}
          </div>
        </Panel>
        <Panel title="Responsible AI principles">
          <div className="dashboard-chart-plot"><PrincipleRadar principles={principleAvg} height={220} /></div>
        </Panel>
      </div>
      <section className="section">
        <div className="section-head"><h2>Lifecycle pipeline</h2><span className="xs mute">All clients</span></div>
        <PipelineBoard systems={systems} nav={nav} showClient highlight={(s) => waitsFor(s, role)} />
      </section>
    </div>
  );
}

// ---------------- admin ----------------
function AdminHome({ nav }) {
  const { state, systems } = useStore();
  const byRole = Object.keys(ROLES).map((r) => ({ r, n: state.users.filter((u) => u.role === r).length }));
  const links = [
    { to: '/admin', icon: Users, title: 'Clients and users', text: `${state.clients.length} clients, ${state.users.length} users` },
    { to: '/bank', icon: Library, title: 'Question bank', text: `${QUESTIONS.length} questions` },
    { to: '/settings', icon: Settings, title: 'Settings', text: 'Risk cut-offs, review cycles, demo data' },
    { to: '/audit', icon: History, title: 'Audit log', text: `${state.audit.length} entries` },
  ];
  return (
    <div className="fade-in">
      <div className="page-head"><div><div className="eyebrow">Administrator</div><h1>Workspace setup</h1></div></div>
      <div className="kpis">
        <Kpi icon={Users} value={state.clients.length} label="Clients" onClick={() => nav('/admin')} />
        <Kpi icon={Users} value={state.users.length} label="Users" onClick={() => nav('/admin')} />
        <Kpi icon={Boxes} value={live(systems).length} label="Live AI products" onClick={() => nav('/products')} />
        <Kpi icon={Library} value={QUESTIONS.length} label="Questions in the bank" onClick={() => nav('/bank')} />
      </div>
      <div className="grid g-wide section">
        <div className="link-grid">
          {links.map(({ to, icon: Icon, title, text }) => (
            <button key={to} type="button" className="link-card" onClick={() => nav(to)}>
              <span className="kpi-ico"><Icon size={18} /></span><b>{title}</b><span className="small mute">{text}</span><ArrowRight size={16} className="lc-go" />
            </button>
          ))}
        </div>
        <Panel title="Users by role">
          {byRole.map(({ r, n }) => <div key={r} className="spread" style={{ padding: '7px 0', borderTop: '1px solid var(--line-2)' }}><span className="small">{ROLES[r].name}</span><b className="num">{n}</b></div>)}
        </Panel>
      </div>
      <Panel title="Recent activity" className="section" right={<button className="btn ghost sm" onClick={() => nav('/audit')}>Audit log <ArrowRight size={14} /></button>}>
        {state.audit.slice(0, 8).map((a, i) => (
          <div key={i} className="spread small" style={{ padding: '7px 0', borderTop: i ? '1px solid var(--line-2)' : 0 }}>
            <span style={{ minWidth: 0 }}><b style={{ fontWeight: 500 }}>{a.action}</b> <span className="mute">{a.detail}</span></span>
            <span className="xs mute num" style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.at)}</span>
          </div>
        ))}
      </Panel>
    </div>
  );
}

export default function Dashboard({ nav }) {
  const { role } = useStore();
  if (role === 'client') return <ClientHome nav={nav} />;
  if (role === 'lead') return <LeadHome nav={nav} />;
  if (role === 'admin') return <AdminHome nav={nav} />;
  return <ReviewerHome nav={nav} />;
}
