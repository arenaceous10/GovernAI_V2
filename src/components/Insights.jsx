// Client portfolio insights: interactive charts. Clicking a bar, slice or dot filters the product list below
// (or opens the product), so the charts work as a way into the work, not only as a picture.
import { useMemo, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { TIERS, TIER_ORDER, PRINCIPLE_IDS } from '../data/frameworks.js';
import { STAGES, STAGE_STATUS } from '../data/lifecycle.js';
import { controlStatus, compassScores, COMPASS, COMPASS_IDS, itemState } from '../data/controls.js';
import { PrincipleRadar } from './Results.jsx';
import { Panel, TierBadge, StatusPill, useShowMore } from './ui.jsx';
import { stageLabel } from './Stages.jsx';
import { useStore } from '../store/store.jsx';

const AX = { fontSize: 11, fill: '#4A5568' };
const STATUS_COLORS = { 'In progress': '#4F6F9E', Returned: '#A86A12', 'Awaiting review': '#2FA8E0', 'In production': '#2F7D4F' };
const today = () => new Date().toISOString().slice(0, 10);
const statusOf = (s) => (s.status === 'In production' && !['submitted', 'returned'].includes(s.stages?.[s.stage]?.status) ? 'In production' : STAGE_STATUS[s.stages?.[s.stage]?.status || 'open']);

function ChartTip({ active, payload, label, render }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tip">{render ? render(payload, label) : <><b>{label}</b>{payload.map((p) => <div key={p.name}>{p.name}: {p.value}</div>)}</>}</div>;
}

export default function ClientInsights({ systems, nav }) {
  const { state } = useStore();
  const rules = state.settings.checklistRules || {};
  const list = systems.filter((s) => s.assessment && s.status !== 'Draft');
  const [f, setF] = useState(null);   // { kind, value, label }
  const toggle = (kind, value, label) => setF((x) => (x && x.kind === kind && x.value === value ? null : { kind, value, label }));

  const byStage = useMemo(() => STAGES.map((st) => {
    const here = list.filter((s) => s.stage === st.n && s.status !== 'Retired');
    const row = { n: st.n, name: `${st.n}. ${st.short}` };
    for (const k of Object.keys(STATUS_COLORS)) row[k] = here.filter((s) => statusOf(s) === k).length;
    return row;
  }), [list]);
  const tiers = TIER_ORDER.map((t) => ({ t, name: TIERS[t].label, value: list.filter((s) => s.assessment.results.tier === t).length, color: TIERS[t].color })).filter((x) => x.value);
  const scatter = list.map((s) => ({ id: s.id, name: s.name, x: s.assessment.results.readiness, y: s.assessment.results.residual, z: Math.max(1, s.actions.filter((a) => a.status !== 'Done').length), tier: s.assessment.results.tier }));
  const actions = list.map((s) => {
    const open = s.actions.filter((a) => a.status !== 'Done');
    return { id: s.id, name: s.name.length > 22 ? `${s.name.slice(0, 21)}…` : s.name, full: s.name, High: open.filter((a) => a.priority === 'High').length, Medium: open.filter((a) => a.priority === 'Medium').length, Low: open.filter((a) => a.priority === 'Low').length, overdue: open.filter((a) => a.due < today()).length };
  }).filter((x) => x.High + x.Medium + x.Low).sort((a, b) => b.High + b.Medium + b.Low - (a.High + a.Medium + a.Low)).slice(0, 8);
  const checklist = list.filter((s) => !['Retired', 'Blocked'].includes(s.status)).map((s) => {
    const st = STAGES[s.stage - 1]; const rec = s.stages?.[s.stage] || {};
    const states = st.checklist.map((i) => itemState(rec, i));
    const pct = (k) => Math.round((states.filter((x) => x === k).length / states.length) * 100);
    return { id: s.id, name: s.name.length > 22 ? `${s.name.slice(0, 21)}…` : s.name, full: s.name, Ticked: pct('done'), Skipped: pct('skipped'), Open: pct('open'), stage: s.stage };
  }).sort((a, b) => b.Open - a.Open).slice(0, 12);   // the 12 with most left to do; a chart of hundreds of bars is unreadable
  const avg = (xs) => { const v = xs.filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const principleAvg = Object.fromEntries(PRINCIPLE_IDS.map((k) => [k, { risk: avg(list.map((s) => s.assessment.results.principles[k]?.risk)), readiness: avg(list.map((s) => s.assessment.results.principles[k]?.readiness)) }]));
  // Compass scores and control gaps are worked out once per product list, not on every render.
  const compassOf = useMemo(() => new Map(list.map((s) => [s.id, compassScores(s).scores])), [systems]); // eslint-disable-line react-hooks/exhaustive-deps
  const compass = COMPASS_IDS.map((k) => ({ k, name: COMPASS[k].name, v: avg(list.map((s) => compassOf.get(s.id)?.[k])) }));
  const gaps = useMemo(() => list.reduce((n, s) => n + controlStatus(s, rules).filter((c) => c.status === 'Gap' || c.status === 'Partial').length, 0), [systems, rules]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = list.filter((s) => !f
    || (f.kind === 'stage' && s.stage === f.value && s.status !== 'Retired')
    || (f.kind === 'status' && statusOf(s) === f.value)
    || (f.kind === 'tier' && s.assessment.results.tier === f.value)
    || (f.kind === 'compass' && (compassOf.get(s.id)?.[f.value] ?? 100) < 50));
  const [shownList, moreList] = useShowMore(filtered);

  if (!list.length) return null;
  return (
    <section className="section">
      <div className="section-head"><h2>Portfolio insights</h2><span className="xs mute">Click a bar, slice or dot to filter or open</span></div>
      <div className="insight-grid">
        <Panel title="Where your products are in the lifecycle" sub="Products per stage, by status" className="span-2">
          <div style={{ height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={byStage} margin={{ top: 6, right: 8, bottom: 0, left: -18 }} onClick={(e) => { const n = e?.activePayload?.[0]?.payload?.n; if (n) toggle('stage', n, `Stage ${n}: ${STAGES[n - 1].short}`); }}>
                <CartesianGrid stroke="#E3E8EF" vertical={false} />
                <XAxis dataKey="name" tick={{ ...AX, fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={54} axisLine={{ stroke: '#D5DCE5' }} tickLine={false} />
                <YAxis allowDecimals={false} tick={AX} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(65,82,217,0.06)' }} content={<ChartTip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} onClick={(e) => toggle('status', e.value, e.value)} />
                {Object.entries(STATUS_COLORS).map(([k, c], i, arr) => (
                  <Bar key={k} dataKey={k} stackId="s" fill={c} radius={i === arr.length - 1 ? [4, 4, 0, 0] : 0} style={{ cursor: 'pointer' }}>
                    {byStage.map((row) => <Cell key={row.n} fillOpacity={!f || f.kind !== 'stage' || f.value === row.n ? 1 : 0.3} />)}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Risk mix" sub={`${list.length} products`}>
          <div style={{ height: 250 }} className="donut-wrap">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={tiers} dataKey="value" nameKey="name" innerRadius="56%" outerRadius="82%" paddingAngle={2} onClick={(d) => toggle('tier', d.t, `${d.name} risk`)} style={{ cursor: 'pointer' }}>
                  {tiers.map((x) => <Cell key={x.t} fill={x.color} fillOpacity={!f || f.kind !== 'tier' || f.value === x.t ? 1 : 0.3} stroke="#fff" />)}
                </Pie>
                <Tooltip content={<ChartTip render={(p) => <><b>{p[0].name}</b><div>{p[0].value} product{p[0].value > 1 ? 's' : ''}</div></>} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center"><b className="num">{list.filter((s) => ['high', 'unacceptable'].includes(s.assessment.results.tier)).length}</b><span className="xs mute">high or above</span></div>
          </div>
        </Panel>

        <Panel title="Risk against controls in place" sub="Each dot is a product; bigger dots have more open actions. Click to open.">
          <div style={{ height: 250 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: -14 }}>
                <CartesianGrid stroke="#E3E8EF" />
                <XAxis type="number" dataKey="x" name="Controls in place" unit="%" domain={[0, 100]} tick={AX} axisLine={{ stroke: '#D5DCE5' }} tickLine={false} />
                <YAxis type="number" dataKey="y" name="Score" domain={[0, 100]} tick={AX} axisLine={false} tickLine={false} />
                <ZAxis type="number" dataKey="z" range={[60, 320]} />
                <ReferenceLine y={60} stroke="#B83A2E" strokeDasharray="4 4" label={{ value: 'High', position: 'insideTopRight', fontSize: 10, fill: '#B83A2E' }} />
                <ReferenceLine y={35} stroke="#A86A12" strokeDasharray="4 4" label={{ value: 'Limited', position: 'insideTopRight', fontSize: 10, fill: '#A86A12' }} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<ChartTip render={(p) => { const d = p[0].payload; return <><b>{d.name}</b><div>Score {d.y}/100 · {d.x}% controls</div><div>{d.z} open actions</div></>; }} />} />
                <Scatter data={scatter} onClick={(d) => nav(`/product/${d.id}`)} style={{ cursor: 'pointer' }}>
                  {scatter.map((d) => <Cell key={d.id} fill={TIERS[d.tier].color} fillOpacity={0.8} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Current stage checklist" sub="Share of checks ticked, skipped with a reason, or open">
          <div style={{ height: Math.max(150, checklist.length * 34 + 50) }}>
            <ResponsiveContainer>
              <BarChart data={checklist} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 8 }} onClick={(e) => { const id = e?.activePayload?.[0]?.payload?.id; if (id) nav(`/product/${id}`); }}>
                <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} unit="%" tick={AX} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={140} tick={{ ...AX, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(65,82,217,0.06)' }} content={<ChartTip render={(p) => { const d = p[0].payload; return <><b>{d.full}</b><div>Stage {d.stage}: {d.Ticked}% ticked, {d.Skipped}% skipped, {d.Open}% open</div></>; }} />} />
                <Bar dataKey="Ticked" stackId="c" fill="#2F7D4F" style={{ cursor: 'pointer' }} />
                <Bar dataKey="Skipped" stackId="c" fill="#A86A12" style={{ cursor: 'pointer' }} />
                <Bar dataKey="Open" stackId="c" fill="#D5DCE5" radius={[0, 4, 4, 0]} style={{ cursor: 'pointer' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Open actions" sub={`By priority, most first${gaps ? ` · ${gaps} control${gaps > 1 ? 's' : ''} with a gap` : ''}`}>
          {actions.length === 0 ? <p className="small mute">No open actions.</p> : (
            <div style={{ height: Math.max(150, actions.length * 34 + 50) }}>
              <ResponsiveContainer>
                <BarChart data={actions} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 8 }} onClick={(e) => { const id = e?.activePayload?.[0]?.payload?.id; if (id) nav(`/product/${id}`); }}>
                  <XAxis type="number" allowDecimals={false} tick={AX} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ ...AX, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(65,82,217,0.06)' }} content={<ChartTip render={(p) => { const d = p[0].payload; return <><b>{d.full}</b><div>{d.High} high, {d.Medium} medium, {d.Low} low</div>{d.overdue ? <div className="tone-bad">{d.overdue} overdue</div> : null}</>; }} />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="High" stackId="a" fill="#B83A2E" style={{ cursor: 'pointer' }} />
                  <Bar dataKey="Medium" stackId="a" fill="#A86A12" style={{ cursor: 'pointer' }} />
                  <Bar dataKey="Low" stackId="a" fill="#4F6F9E" radius={[0, 4, 4, 0]} style={{ cursor: 'pointer' }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="Responsible AI principles" sub="Average across your products">
          <PrincipleRadar principles={principleAvg} height={250} />
        </Panel>

        <Panel title="Responsible AI Compass" sub="Average per direction. Click a weak one to see the products below 50." className="span-2">
          <div className="compass-bars">
            {compass.map((c) => (
              <button key={c.k} type="button" className={`cb-row ${f?.kind === 'compass' && f.value === c.k ? 'on' : ''}`} onClick={() => toggle('compass', c.k, `${c.name} below 50`)}>
                <span className={`small ${COMPASS[c.k].kind === 'direction' ? 'b' : ''}`}>{c.name}</span>
                <span className="meter"><i style={{ width: `${c.v ?? 0}%`, background: (c.v ?? 0) >= 70 ? 'var(--good)' : (c.v ?? 0) >= 40 ? 'var(--warn)' : 'var(--bad)' }} /></span>
                <span className="xs num">{c.v ?? '—'}</span>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <Panel className="section-tight" title={f ? `Products: ${f.label}` : 'All products'} right={f && <button className="btn ghost sm" onClick={() => setF(null)}><X size={14} /> Clear filter</button>}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Product</th><th>Tier</th><th>Stage</th><th>Status</th><th className="num">Score</th><th className="num">Controls</th><th className="num">Open actions</th><th /></tr></thead>
            <tbody>
              {shownList.map((s) => (
                <tr key={s.id} className="click" onClick={() => nav(`/product/${s.id}`)}>
                  <td><b style={{ fontWeight: 500 }}>{s.name}</b><div className="xs mute">{s.code}</div></td>
                  <td><TierBadge tier={s.assessment.results.tier} /></td>
                  <td className="small">{s.stage}. {STAGES[s.stage - 1].short}</td>
                  <td><StatusPill status={stageLabel(s)} /></td>
                  <td className="num">{s.assessment.results.residual}</td>
                  <td className="num">{s.assessment.results.readiness}%</td>
                  <td className="num">{s.actions.filter((a) => a.status !== 'Done').length}</td>
                  <td><ArrowRight size={14} className="mute" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {moreList}
          {filtered.length === 0 && <div className="empty">No products match this filter.</div>}
        </div>
      </Panel>
    </section>
  );
}
