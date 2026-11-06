import { useMemo, useState } from 'react';
import { Download, Search, Trash2 } from 'lucide-react';
import { TIERS, TIER_ORDER } from '../data/frameworks.js';
import { STAGES, STAGE_STATUS } from '../data/lifecycle.js';
import { Panel, TierBadge, StatusPill, fmtDate } from '../components/ui.jsx';
import { StageMini } from '../components/Stages.jsx';
import { useStore } from '../store/store.jsx';

// Cells starting with = + - @ or a tab/return are prefixed with ' so a spreadsheet shows them as text, not a formula.
const cell = (v) => { const t = String(v ?? ''); return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t; };
const csv = (rows) => rows.map((r) => r.map((v) => `"${cell(v).replaceAll('"', '""')}"`).join(',')).join('\n');

export default function Products({ nav }) {
  const { state, systems, role, deleteDraft } = useStore();
  const [q, setQ] = useState(''); const [tier, setTier] = useState(''); const [stage, setStage] = useState(''); const [cl, setCl] = useState('');
  const cname = (id) => state.clients.find((c) => c.id === id)?.name || '';
  const drafts = systems.filter((s) => s.status === 'Draft');
  const rows = useMemo(() => systems.filter((s) => s.status !== 'Draft' && s.assessment).filter((s) =>
    (!q || `${s.name} ${s.code} ${s.bu} ${s.owner} ${cname(s.clientId)}`.toLowerCase().includes(q.toLowerCase()))
    && (!tier || s.assessment.results.tier === tier) && (!stage || String(s.stage) === stage) && (!cl || s.clientId === cl)),
  [systems, q, tier, stage, cl]); // eslint-disable-line react-hooks/exhaustive-deps

  function exportCsv() {
    const data = [['Code', 'Client', 'Product', 'Owner', 'Tier', 'Score', 'Controls in place %', 'Stage', 'Stage status', 'Status'],
      ...rows.map((s) => [s.code, cname(s.clientId), s.name, s.owner, TIERS[s.assessment.results.tier].label, s.assessment.results.residual, s.assessment.results.readiness, `${s.stage}. ${STAGES[s.stage - 1].name}`, STAGE_STATUS[s.stages?.[s.stage]?.status || 'open'], s.status])];
    const url = URL.createObjectURL(new Blob([csv(data)], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: 'ai-products.csv' }).click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="page-head">
        <div><h1>AI products</h1></div>
        <div className="row">
          <button className="btn" onClick={exportCsv}><Download size={16} /> Export</button>
          {role === 'client' && <button className="btn primary" onClick={() => nav('/new')}>Register an AI product</button>}
        </div>
      </div>
      {drafts.length > 0 && (
        <Panel title="Drafts" style={{ marginBottom: 16 }}>
          {drafts.map((d) => (
            <div key={d.id} className="spread" style={{ padding: '6px 0' }}>
              <span>{d.name} <span className="xs mute">saved {fmtDate(d.updatedAt)}</span></span>
              <span className="row">
                <button className="btn ghost sm" aria-label={`Delete draft ${d.name}`} onClick={() => deleteDraft(d.id)}><Trash2 size={14} /></button>
                <button className="btn sm" onClick={() => nav(`/draft/${d.id}`)}>Continue</button>
              </span>
            </div>
          ))}
        </Panel>
      )}
      <Panel>
        <div className={`grid ${role === 'client' ? 'g3' : 'g4'}`} style={{ marginBottom: 14 }}>
          <label className="field" style={{ position: 'relative' }}>
            <span>Search</span>
            <input className="input" style={{ paddingLeft: 32 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, code or owner" />
            <Search size={15} style={{ position: 'absolute', left: 10, top: 38, color: '#5A6478' }} />
          </label>
          {role !== 'client' && <label className="field"><span>Client</span><select className="input" value={cl} onChange={(e) => setCl(e.target.value)}><option value="">All clients</option>{state.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          <label className="field"><span>Tier</span><select className="input" value={tier} onChange={(e) => setTier(e.target.value)}><option value="">All tiers</option>{TIER_ORDER.map((t) => <option key={t} value={t}>{TIERS[t].label}</option>)}</select></label>
          <label className="field"><span>Stage</span><select className="input" value={stage} onChange={(e) => setStage(e.target.value)}><option value="">All stages</option>{STAGES.map((s) => <option key={s.n} value={s.n}>{s.n}. {s.name}</option>)}</select></label>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Product</th><th>Tier</th><th>Score</th><th>Controls in place</th><th>Stage</th><th>Stage status</th></tr></thead>
            <tbody>
              {rows.map((s) => {
                const r = s.assessment.results;
                return (
                  <tr key={s.id} className="click" onClick={() => nav(`/product/${s.id}`)}>
                    <td><b style={{ fontWeight: 500 }}>{s.name}</b><div className="xs mute">{role !== 'client' ? `${cname(s.clientId)}, ` : ''}{s.code}</div></td>
                    <td><TierBadge tier={r.tier} /></td>
                    <td className="num">{r.residual}</td>
                    <td className="num">{r.readiness}%</td>
                    <td><StageMini s={s} /></td>
                    <td><StatusPill status={s.status === 'Blocked' || s.status === 'Retired' ? s.status : STAGE_STATUS[s.stages?.[s.stage]?.status || 'open']} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <div className="empty">No products match.</div>}
        </div>
      </Panel>
    </div>
  );
}
