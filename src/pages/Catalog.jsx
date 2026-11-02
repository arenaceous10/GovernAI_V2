import { useMemo, useState } from 'react';
import { CLASSIFICATIONS } from '../data/lifecycle.js';
import { Panel, Pill, Stat, TierBadge } from '../components/ui.jsx';
import { catalogCoverage } from '../components/DataAssets.jsx';
import { useStore } from '../store/store.jsx';

export default function Catalog({ nav }) {
  const { systems } = useStore();
  const [q, setQ] = useState(''); const [cls, setCls] = useState(''); const [gap, setGap] = useState('');
  const assets = useMemo(() => {
    const map = new Map();
    for (const s of systems.filter((x) => x.status !== 'Retired')) {
      for (const d of s.datasets) {
        const key = `${d.name}|${d.sourceSystem}`.toLowerCase();
        const cur = map.get(key) || { ...d, users: [] };
        cur.users.push(s);
        cur.catalogued = cur.catalogued && d.catalogued; cur.lineage = cur.lineage && d.lineage; cur.qualityChecked = cur.qualityChecked && d.qualityChecked;
        cur.steward = cur.steward || d.steward; cur.personal = cur.personal || d.personal;
        map.set(key, cur);
      }
    }
    return [...map.values()];
  }, [systems]);
  const cov = catalogCoverage(assets);
  const rows = assets.filter((d) => (!q || `${d.name} ${d.sourceSystem} ${d.owner} ${d.steward}`.toLowerCase().includes(q.toLowerCase()))
    && (!cls || d.classification === cls)
    && (!gap || (gap === 'catalog' && !d.catalogued) || (gap === 'lineage' && !d.lineage) || (gap === 'steward' && !d.steward) || (gap === 'quality' && !d.qualityChecked) || (gap === 'personal' && d.personal)));
  return (
    <div>
      <div className="page-head">
        <div><h1>Data catalog</h1><p>Every dataset that feeds an AI system: who owns it, how sensitive it is, and whether it is catalogued, traced and quality checked.</p></div>
      </div>
      <div className="grid g4">
        <Stat value={`${cov.catalogued}%`} label="Registered in the catalog" />
        <Stat value={`${cov.lineage}%`} label="Lineage documented" />
        <Stat value={`${cov.stewarded}%`} label="Data steward named" />
        <Stat value={`${cov.quality}%`} label="Quality rules running" />
      </div>
      <Panel style={{ marginTop: 16 }}>
        <div className="grid g3" style={{ marginBottom: 14 }}>
          <label className="field"><span>Search</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Dataset, source, owner or steward" /></label>
          <label className="field"><span>Classification</span><select className="input" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All</option>{CLASSIFICATIONS.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="field"><span>Show</span>
            <select className="input" value={gap} onChange={(e) => setGap(e.target.value)}>
              <option value="">All datasets</option><option value="personal">Contains personal data</option><option value="catalog">Not in the catalog</option>
              <option value="lineage">No lineage</option><option value="steward">No steward</option><option value="quality">No quality rules</option>
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Dataset</th><th>Source system</th><th>Class</th><th>Owner and steward</th><th>Catalog</th><th>Lineage</th><th>Quality</th><th>Used by</th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={`${d.name}|${d.sourceSystem}`}>
                  <td><b style={{ fontWeight: 500 }}>{d.name}</b><div className="xs mute">{d.role}{d.personal ? ', personal data' : ''}</div></td>
                  <td className="small">{d.sourceSystem}</td>
                  <td><span className="tag">{d.classification}</span></td>
                  <td className="small">{d.owner || '—'}<div className="xs">{d.steward ? <span className="mute">Steward {d.steward}</span> : <span className="tone-bad">No steward</span>}</div></td>
                  {['catalogued', 'lineage', 'qualityChecked'].map((k) => <td key={k}><Pill tone={d[k] ? 'good' : 'bad'}>{d[k] ? 'Yes' : 'No'}</Pill></td>)}
                  <td>
                    {d.users.map((s) => (
                      <button key={s.id} className="btn ghost sm" style={{ display: 'flex', gap: 6, padding: '2px 0' }} onClick={() => nav(`/system/${s.id}`)}>
                        {s.name} <TierBadge tier={s.assessment.results.tier} />
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="empty">No datasets match. Register datasets from a system's Data & lineage tab.</div>}
        </div>
      </Panel>
    </div>
  );
}
