// Model registry panel on the AI card: connect MLflow or Databricks Unity Catalog with a read-only token, see the
// registered versions and their metrics, and turn a new version into a change review.
import { useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, FlaskConical, Link2, Loader2, PlugZap, RefreshCw, Settings2, Unplug } from 'lucide-react';
import { cloud } from '../lib/cloud.js';
import { callApi } from '../lib/api.js';
import { Field, Panel, Pill, fmtDate } from './ui.jsx';
import { toast } from './Extras.jsx';
import { useStore } from '../store/store.jsx';
import { registryOpen, REGISTRY_CLOSED_TEXT } from '../lib/registryStage.js';

const KIND = { mlflow: 'MLflow model registry', 'databricks-uc': 'Databricks Unity Catalog' };
const STALE_MS = 12 * 3600 * 1000;

export async function syncProduct(store, s, { quiet = false } = {}) {
  if (!registryOpen(s)) throw new Error(REGISTRY_CLOSED_TEXT);
  const res = await callApi('/api/connector', { action: 'sync', productId: s.id });
  const outcome = store.applyModelSync(s.id, res);
  if (!quiet || outcome !== 'same') {
    toast(outcome === 'raised' ? `New version ${res.latest} found: change review opened (stage 8)`
      : outcome === 'found' ? `New version ${res.latest} found in the registry`
        : outcome === 'drift' ? `Drift detected in ${res.monitoring?.table}: ${res.monitoring?.drift?.drifted?.length} column(s)`
        : 'Registry checked: no new version', outcome === 'same' ? 'good' : 'warn');
  }
  return outcome;
}

export default function RegistryPanel({ s }) {
  const store = useStore();
  const { role, connectModel, disconnectModel, setConnectorConfig } = store;
  const [cfg, setCfg] = useState(null);
  const c = s.connector;
  const open = registryOpen(s);
  const canConnect = open && ['client', 'admin'].includes(role) && !['Retired', 'Withdrawn'].includes(s.status);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const auto = useRef(false);

  // Check once when the card opens if the last check is older than 12 hours.
  useEffect(() => {
    if (!cloud || !open || !c?.host || auto.current) return;
    if (c.lastSync && Date.now() - new Date(c.lastSync).getTime() < STALE_MS) return;
    auto.current = true;
    syncProduct(store, s, { quiet: true }).catch(() => {});
  }, [c?.host]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    setErr(''); setBusy('test');
    try {
      const result = await callApi('/api/connector', { action: 'test', productId: s.id, kind: form.kind, host: form.host, model: form.model, token: form.token,
        experiment: form.experiment, monitorTable: form.monitorTable, warehouseId: form.warehouseId });
      setBusy('seal');
      const { sealed } = form.token ? await callApi('/api/connector', { action: 'seal', productId: s.id, token: form.token }) : { sealed: '' };
      connectModel(s.id, { kind: form.kind, host: form.host.trim().replace(/\/+$/, ''), model: form.model.trim(), tokenSealed: sealed, result,
        experiment: form.experiment, monitorTable: form.monitorTable, warehouseId: form.warehouseId });
      setForm(null);
      toast(`Connected: ${result.versions.length} version${result.versions.length === 1 ? '' : 's'} found`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  };
  const sync = async () => {
    setBusy('sync');
    try { await syncProduct(store, s); } catch (e) { toast(`Could not read the registry: ${e.message}`, 'warn'); }
    finally { setBusy(''); }
  };

  const alerts = (c?.alerts || []).filter((a) => !a.raised && a.kind !== 'drift').slice(-3).reverse();
  return (
    <Panel title={<span className="row" style={{ gap: 6 }}><PlugZap size={15} /> Model registry</span>}
      sub="Versions and metrics come straight from where the model is registered. A new version in production opens a change review."
      right={c && cloud && open ? <button className="btn ghost sm" onClick={sync} disabled={!!busy}>{busy === 'sync' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Check now</button> : null}>
      {cloud && !open && <p className="small mute">{REGISTRY_CLOSED_TEXT} Nothing is read from or written to a registry before then.</p>}
      {!cloud && <p className="small mute">Available when GovernAI is connected to its cloud database, because the token is kept sealed on the server.</p>}
      {cloud && open && !c && !form && (
        <div>
          <p className="small mute">Not connected. Connect MLflow or Databricks Unity Catalog with a read-only token to keep versions and metrics up to date without copying them by hand.</p>
          {canConnect && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setForm({ kind: 'databricks-uc', host: '', model: '', token: '', experiment: '', monitorTable: '', warehouseId: '' })}><Link2 size={14} /> Connect a model registry</button>}
        </div>
      )}
      {form && (
        <div className="stack">
          <Field label="Registry"><select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></Field>
          <Field label="Workspace or server address" hint={form.kind === 'databricks-uc' ? 'e.g. https://adb-1234567890.12.azuredatabricks.net' : 'e.g. https://mlflow.yourcompany.com'}>
            <input className="input" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="https://" />
          </Field>
          <Field label="Registered model name" hint={form.kind === 'databricks-uc' ? 'catalog.schema.model, e.g. main.claims.triage' : 'Exactly as it appears in the registry'}>
            <input className="input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </Field>
          <Field label="Read-only access token" hint="Create a token that can only read this model. It is encrypted by the server and never shown again.">
            <input className="input" type="password" autoComplete="off" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
          </Field>
          <AdvancedFields v={form} set={(p) => setForm({ ...form, ...p })} kind={form.kind} />
          {err && <p className="small bad-text" role="alert">{err}</p>}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={() => { setForm(null); setErr(''); }}>Cancel</button>
            <button className="btn primary" disabled={!!busy || !form.host || !form.model} onClick={connect}>{busy ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />} Test and connect</button>
          </div>
        </div>
      )}
      {c && (
        <div className="stack">
          <dl className="kv small">
            <dt>Registry</dt><dd>{KIND[c.kind] || c.kind}</dd>
            <dt>Model</dt><dd className="mono">{c.model}</dd>
            <dt>Latest version</dt><dd><b>{c.latest || '—'}</b>{s.card?.modelVersion && c.latest && String(s.card.modelVersion) !== String(c.latest) ? <Pill tone="warn">Card says {s.card.modelVersion}</Pill> : null}</dd>
            <dt>Last checked</dt><dd>{c.lastSync ? new Date(c.lastSync).toLocaleString('en-GB') : 'Never'}</dd>
          </dl>
          {alerts.map((a) => (
            <div key={a.at} className="verdict warn"><AlertTriangle size={18} aria-hidden /><div className="small"><b>Version {a.version} found on {fmtDate(a.at)}</b> (was {a.from}).
              {s.stage === 7 && s.status === 'In production' ? ' Raise a change on the lifecycle tab to review it before it is used.' : ' It is recorded here and in the change history.'}</div></div>
          ))}
          {(c.versions || []).length > 0 && (
            <table className="table small">
              <thead><tr><th>Version</th><th>Registered</th><th>Stage or alias</th><th>Metrics</th></tr></thead>
              <tbody>
                {c.versions.slice(0, 6).map((v) => (
                  <tr key={v.version}>
                    <td className="num"><b>{v.version}</b></td><td>{fmtDate(v.createdAt)}</td>
                    <td>{[v.stage, ...(v.aliases || [])].filter(Boolean).join(', ') || '—'}</td>
                    <td className="xs">{v.metrics && Object.keys(v.metrics).length ? Object.entries(v.metrics).slice(0, 4).map(([k, x]) => `${k} ${Math.round(x * 1000) / 1000}`).join(' · ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {cfg && (
            <div className="stack" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 10 }}>
              <AdvancedFields v={cfg} set={(p) => setCfg({ ...cfg, ...p })} kind={c.kind} open />
              <div className="row" style={{ gap: 8 }}>
                <button className="btn sm" onClick={() => setCfg(null)}>Cancel</button>
                <button className="btn primary sm" onClick={async () => { setConnectorConfig(s.id, cfg); setCfg(null); toast('Settings saved. Checking the registry…'); setBusy('sync'); try { await syncProduct(store, { ...s, connector: { ...c, ...cfg } }); } catch (e) { toast(`Could not read the registry: ${e.message}`, 'warn'); } finally { setBusy(''); } }}>Save and check</button>
              </div>
            </div>
          )}
          {canConnect && !cfg && (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn ghost sm" onClick={() => setCfg({ experiment: c.experiment || '', monitorTable: c.monitorTable || '', warehouseId: c.warehouseId || '' })}><Settings2 size={14} /> Evaluations and monitoring</button>
              <button className="btn ghost sm" onClick={() => { if (window.confirm('Disconnect the model registry? The saved token is deleted.')) disconnectModel(s.id); }}><Unplug size={14} /> Disconnect</button>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// Optional: where GenAI evaluations and traces, and production monitoring, are read from.
function AdvancedFields({ v, set, kind, open: startOpen = false }) {
  const [open, setOpen] = useState(startOpen || !!(v.experiment || v.monitorTable || v.warehouseId));
  return (
    <div>
      <button type="button" className="btn ghost sm" style={{ paddingLeft: 0 }} aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronDown size={14} className={`chev ${open ? 'open' : ''}`} /> Evaluations, traces and monitoring (optional)
      </button>
      {open && (
        <div className="stack fade-in" style={{ marginTop: 6 }}>
          <Field label="MLflow experiment for evaluations and traces" hint="Experiment ID or path, e.g. /Users/you@company.com/risklens_poc. Leave empty to use the experiment of the latest model version.">
            <input className="input" value={v.experiment || ''} onChange={(e) => set({ experiment: e.target.value })} />
          </Field>
          {kind === 'databricks-uc' && (
            <>
              <Field label="Monitored table" hint="catalog.schema.table with a data profiling monitor, usually the model's inference table">
                <input className="input" value={v.monitorTable || ''} onChange={(e) => set({ monitorTable: e.target.value })} placeholder="workspace.default.risklens_inference" />
              </Field>
              <Field label="SQL warehouse ID" hint="Needed to read drift values and lineage. In Databricks: SQL Warehouses → your warehouse → the ID in its connection details.">
                <input className="input" value={v.warehouseId || ''} onChange={(e) => set({ warehouseId: e.target.value })} />
              </Field>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const pct = (x) => (x == null ? '—' : x <= 1 ? `${Math.round(x * 1000) / 10}%` : Math.round(x * 1000) / 1000);
const metricLabel = (k) => k.replace(/\/mean$|_mean$/, '').replace(/\/pass_rate$|_pass_rate$/, ' pass rate').replace(/[_/]/g, ' ');

// Evidence for GenAI products: evaluation runs (mlflow.genai.evaluate) and traces of real or test calls.
export function GenAIPanel({ s }) {
  const g = s.connector?.genai;
  if (!s.connector) return null;
  const evals = g?.evaluations || [];
  return (
    <Panel title={<span className="row" style={{ gap: 6 }}><FlaskConical size={15} /> Evaluations and traces</span>}
      sub="From MLflow: scored evaluation runs and recorded calls. Updated each time the registry is checked.">
      {!g ? <p className="small mute">Not read yet. Click "Check now" on the Model registry panel.</p> : (
        <div className="stack">
          {evals.length === 0 ? <p className="small mute">No evaluation runs found{g.experimentId ? ` in experiment ${g.experimentId}` : ''}. Run mlflow.genai.evaluate() in that experiment.</p> : (
            <div className="table-wrap"><table className="table small">
              <thead><tr><th>Evaluation run</th><th>Date</th><th>Scores</th></tr></thead>
              <tbody>{evals.slice(0, 5).map((r) => (
                <tr key={r.runId}><td>{r.name || r.runId.slice(0, 8)}</td><td>{fmtDate(r.at)}</td>
                  <td>{Object.entries(r.metrics).slice(0, 6).map(([k, v]) => <span key={k} className="tag" style={{ marginRight: 6 }}>{metricLabel(k)}: <b className="num">{pct(v)}</b></span>)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          {g.traces && (
            <dl className="kv small">
              <dt>Traces</dt><dd>{g.traces.count}{g.traces.more ? '+' : ''} recent{g.traces.errors ? <> · <span className="tone-bad">{g.traces.errors} with errors</span></> : ' · no errors'}</dd>
              <dt>Last call</dt><dd>{g.traces.last ? new Date(g.traces.last).toLocaleString('en-GB') : '—'}</dd>
              {g.traces.latencyMs != null && <><dt>Median time</dt><dd>{Math.round(g.traces.latencyMs)} ms</dd></>}
            </dl>
          )}
          {g.notes?.length > 0 && <p className="xs mute">{g.notes.join('. ')}.</p>}
        </div>
      )}
    </Panel>
  );
}

// Production monitoring from a Databricks data profiling monitor: status, drifted columns, live performance.
export function MonitoringPanel({ s }) {
  const c = s.connector; const m = c?.monitoring;
  if (c?.kind !== 'databricks-uc') return null;
  return (
    <Panel title={<span className="row" style={{ gap: 6 }}><Activity size={15} /> Production monitoring</span>}
      sub="Databricks data profiling monitor. A column counts as drifted when its Jensen-Shannon distance is above 0.1, its population stability index above 0.2, or its Kolmogorov-Smirnov p-value below 0.05.">
      {!c.monitorTable ? <p className="small mute">No monitored table set. Add one under "Evaluations and monitoring" on the Model registry panel.</p>
        : !m ? <p className="small mute">Not read yet. Click "Check now" on the Model registry panel.</p> : (
          <div className="stack">
            <dl className="kv small">
              <dt>Table</dt><dd className="mono">{m.table}</dd>
              <dt>Monitor</dt><dd>{m.monitor ? <Pill tone={/ACTIVE/i.test(m.monitor.status) ? 'good' : /ERROR|FAIL/i.test(m.monitor.status) ? 'bad' : 'warn'}>{m.monitor.status}</Pill> : <Pill tone="bad">None</Pill>}</dd>
              {m.drift && <><dt>Latest window</dt><dd>{m.drift.windowEnd ? new Date(m.drift.windowEnd).toLocaleString('en-GB') : '—'} · {m.drift.checked} columns checked</dd></>}
            </dl>
            {m.drift && (m.drift.drifted.length === 0 ? <div className="verdict ok"><CheckCircle2 size={18} aria-hidden /><div className="small"><b>No drift in the latest window</b></div></div> : (
              <div className="verdict warn"><AlertTriangle size={18} aria-hidden /><div className="small"><b>{m.drift.drifted.length} column{m.drift.drifted.length === 1 ? '' : 's'} drifted</b>
                <div className="xs">{m.drift.drifted.map((d) => `${d.column}${d.js != null ? ` (JS ${Math.round(d.js * 1000) / 1000}` : ' ('}${d.psi != null ? `, PSI ${Math.round(d.psi * 1000) / 1000}` : ''}${d.ksP != null ? `, KS p ${Math.round(d.ksP * 1000) / 1000}` : ''})`).join('; ')}</div>
                {s.stage === 7 && <div className="xs" style={{ marginTop: 4 }}>If this changes how the model behaves, raise an incident or a change on the lifecycle tab.</div>}</div></div>
            ))}
            {m.performance?.metrics && Object.keys(m.performance.metrics).length > 0 && (
              <div><p className="xs mute" style={{ margin: '0 0 6px' }}>Live performance, latest window{m.performance.rows ? ` (${m.performance.rows} rows)` : ''}</p>
                <div className="metric-grid">{Object.entries(m.performance.metrics).map(([k, v]) => <div key={k} className="metric"><span className="xs mute">{k.replace(/_/g, ' ')}</span><b className="num">{Math.round(v * 10000) / 10000}</b></div>)}</div></div>
            )}
            {m.notes?.length > 0 && <p className="xs mute">{m.notes.join('. ')}</p>}
          </div>
        )}
    </Panel>
  );
}
