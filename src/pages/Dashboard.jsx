import { Bar as RBar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TIERS, TIER_ORDER, PRINCIPLE_IDS } from '../data/frameworks.js';
import { STAGES, STAGE_STATUS } from '../data/lifecycle.js';
import { Panel, Stat, TierBadge, StatusPill } from '../components/ui.jsx';
import { PrincipleRadar } from '../components/Results.jsx';
import { StageMini } from '../components/Stages.jsx';
import { useStore, waitingOn } from '../store/store.jsx';

const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const today = () => new Date().toISOString().slice(0, 10);

// What needs this role now.
export function attention(systems, role) {
  const out = [];
  for (const s of systems) {
    const rec = s.stages?.[s.stage];
    if (s.status === 'Draft') { if (role === 'client') out.push({ s, text: 'Draft: finish registration', to: `/draft/${s.id}` }); continue; }
    if (['Blocked', 'Retired'].includes(s.status)) continue;
    const w = waitingOn(s);
    if (role === 'client') {
      if (rec?.status === 'returned') out.push({ s, text: `Stage ${s.stage} returned: ${rec.returnNote}`, urgent: true });
      else if (rec?.status === 'open') out.push({ s, text: `Complete stage ${s.stage}: ${STAGES[s.stage - 1].short}` });
    } else if (role === 'assessor' || role === 'lead') {
      if (w.includes(role) || (role === 'lead' && w.includes('assessor'))) out.push({ s, text: `Review stage ${s.stage}: ${STAGES[s.stage - 1].short}`, urgent: w.includes(role) });
    }
    if (s.nextReview && s.nextReview < today() && s.stage === 7 && role !== 'admin') out.push({ s, text: 'Periodic review overdue' });
  }
  return out.sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent));
}

export default function Dashboard({ nav }) {
  const { systems: all, role, state } = useStore();
  const sys = all.filter((s) => s.status !== 'Draft' && s.assessment);
  const live = sys.filter((s) => s.status !== 'Retired');
  const tierCounts = TIER_ORDER.map((t) => ({ tier: TIERS[t].label, key: t, n: live.filter((s) => s.assessment.results.tier === t).length }));
  const pipeline = STAGES.map((st) => ({ name: `${st.n}`, label: st.short, n: live.filter((s) => s.stage === st.n && s.status !== 'Blocked').length }));
  const awaiting = live.filter((s) => s.stages?.[s.stage]?.status === 'submitted').length;
  const principleAvg = Object.fromEntries(PRINCIPLE_IDS.map((k) => [k, { risk: avg(live.map((s) => s.assessment.results.principles[k]?.risk)), readiness: avg(live.map((s) => s.assessment.results.principles[k]?.readiness).filter((x) => x != null)) }]));
  const items = attention(all, role);
  const cname = (id) => state.clients.find((c) => c.id === id)?.name;

  return (
    <div>
      <div className="page-head">
        <div><h1>{role === 'client' ? `${state.clients.find((c) => c.id === state.clientOrg)?.name || 'Your'} AI portfolio` : 'AI portfolio'}</h1></div>
        {role !== 'admin' && <button className="btn primary" onClick={() => nav('/new')}>Register an AI product</button>}
      </div>

      <div className="grid g4">
        <Stat value={live.length} label="AI products" />
        <Stat value={live.filter((s) => s.status === 'In production').length} label="In production" />
        <Stat value={tierCounts[2].n + tierCounts[3].n} label="High or prohibited" color={tierCounts[2].n + tierCounts[3].n ? 'var(--bad)' : undefined} />
        <Stat value={awaiting} label="Stages awaiting review" />
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Panel title="Risk tiers">
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={tierCounts} layout="vertical" margin={{ left: 10, right: 24 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: '#5A6478' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="tier" width={92} tick={{ fontSize: 13, fill: '#1B2232' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#F3F5F7' }} formatter={(v) => [v, 'Products']} />
                <RBar dataKey="n" radius={[0, 4, 4, 0]} barSize={20} isAnimationActive={false}>
                  {tierCounts.map((t) => <Cell key={t.key} fill={TIERS[t.key].color} />)}
                </RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Lifecycle stage">
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={pipeline} margin={{ left: -20, right: 10 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#5A6478' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#5A6478' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#F3F5F7' }} formatter={(v) => [v, 'Products']} labelFormatter={(l) => `Stage ${l}: ${STAGES[l - 1].short}`} />
                <RBar dataKey="n" fill="#3A46C9" radius={[4, 4, 0, 0]} barSize={22} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid g-wide" style={{ marginTop: 16 }}>
        <Panel title="Needs your attention">
          {items.length === 0 ? <div className="empty">Nothing needs you right now.</div> : (
            <table className="table">
              <tbody>
                {items.slice(0, 7).map((it, i) => (
                  <tr key={i} className="click" onClick={() => nav(it.to || `/product/${it.s.id}`)}>
                    <td><b style={{ fontWeight: 500 }}>{it.s.name}</b>{role !== 'client' && <div className="xs mute">{cname(it.s.clientId)}</div>}</td>
                    <td className={`small ${it.urgent ? 'tone-warn' : ''}`} style={{ maxWidth: 340 }}>{it.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Responsible AI principles"><PrincipleRadar principles={principleAvg} height={240} /></Panel>
      </div>

      <Panel title="AI products" style={{ marginTop: 16 }} right={<button className="btn ghost sm" onClick={() => nav('/products')}>View all</button>}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Product</th><th>Tier</th><th>Score</th><th>Stage</th><th>Stage status</th></tr></thead>
            <tbody>
              {sys.slice(0, 6).map((s) => (
                <tr key={s.id} className="click" onClick={() => nav(`/product/${s.id}`)}>
                  <td><b style={{ fontWeight: 500 }}>{s.name}</b><div className="xs mute">{role !== 'client' ? cname(s.clientId) : s.code}</div></td>
                  <td><TierBadge tier={s.assessment.results.tier} /></td>
                  <td className="num">{s.assessment.results.residual}</td>
                  <td><StageMini stage={s.stage} status={s.status} /></td>
                  <td><StatusPill status={s.status === 'Blocked' ? 'Blocked' : STAGE_STATUS[s.stages?.[s.stage]?.status || 'open']} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {sys.length === 0 && <div className="empty">No AI products yet. Register the first one to see it here.</div>}
        </div>
      </Panel>
    </div>
  );
}
