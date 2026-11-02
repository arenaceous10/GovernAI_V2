import { Plus, Trash2 } from 'lucide-react';
import { CLASSIFICATIONS, DATASET_ROLES, OUTPUT_TARGETS } from '../data/lifecycle.js';
import { Multi } from './ui.jsx';

export const blankDataset = () => ({
  id: `ds-${Math.random().toString(36).slice(2, 8)}`, name: '', sourceSystem: '', role: 'Training', classification: 'Internal',
  personal: false, owner: '', steward: '', catalogued: false, lineage: false, qualityChecked: false,
});

const Check = ({ checked, onChange, label }) => (
  <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
  </label>
);

export function catalogCoverage(datasets = []) {
  const n = datasets.length || 1;
  const pct = (k) => Math.round((100 * datasets.filter(k).length) / n);
  return {
    count: datasets.length,
    catalogued: pct((d) => d.catalogued),
    lineage: pct((d) => d.lineage),
    stewarded: pct((d) => d.steward?.trim()),
    quality: pct((d) => d.qualityChecked),
  };
}

export default function DataAssets({ datasets, outputs, onChange }) {
  const set = (i, patch) => onChange(datasets.map((d, k) => (k === i ? { ...d, ...patch } : d)), outputs);
  return (
    <div className="stack">
      {datasets.length === 0 && <div className="callout">Add each dataset the system reads: training data, live inputs, reference tables or knowledge-base documents.</div>}
      {datasets.map((d, i) => (
        <div key={d.id} className="panel" style={{ padding: 14, background: '#FBFCFD' }}>
          <div className="grid g4" style={{ gap: 10 }}>
            <label className="field"><span>Dataset name</span><input className="input" value={d.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="e.g. Claims history" /></label>
            <label className="field"><span>Source system</span><input className="input" value={d.sourceSystem} onChange={(e) => set(i, { sourceSystem: e.target.value })} placeholder="e.g. Snowflake, SAP" /></label>
            <label className="field"><span>Used as</span><select className="input" value={d.role} onChange={(e) => set(i, { role: e.target.value })}>{DATASET_ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
            <label className="field"><span>Classification</span><select className="input" value={d.classification} onChange={(e) => set(i, { classification: e.target.value })}>{CLASSIFICATIONS.map((r) => <option key={r}>{r}</option>)}</select></label>
            <label className="field"><span>Data owner</span><input className="input" value={d.owner} onChange={(e) => set(i, { owner: e.target.value })} /></label>
            <label className="field"><span>Data steward</span><input className="input" value={d.steward} onChange={(e) => set(i, { steward: e.target.value })} /></label>
            <div style={{ gridColumn: 'span 2' }}>
              <span className="small" style={{ fontWeight: 500, display: 'block', marginBottom: 8 }}>Status</span>
              <div className="row" style={{ gap: 16 }}>
                <Check checked={d.personal} onChange={(v) => set(i, { personal: v })} label="Contains personal data" />
                <Check checked={d.catalogued} onChange={(v) => set(i, { catalogued: v })} label="In the catalog" />
                <Check checked={d.lineage} onChange={(v) => set(i, { lineage: v })} label="Lineage documented" />
                <Check checked={d.qualityChecked} onChange={(v) => set(i, { qualityChecked: v })} label="Quality rules run" />
              </div>
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn ghost sm" onClick={() => onChange(datasets.filter((_, k) => k !== i), outputs)}><Trash2 size={14} /> Remove dataset</button>
          </div>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => onChange([...datasets, blankDataset()], outputs)}><Plus size={16} /> Add dataset</button>
      <hr className="sep" />
      <div>
        <h3 style={{ marginBottom: 8 }}>Where do the outputs go?</h3>
        <Multi chips options={OUTPUT_TARGETS.map((o) => ({ value: o, label: o }))} value={outputs} onChange={(v) => onChange(datasets, v)} />
      </div>
    </div>
  );
}
