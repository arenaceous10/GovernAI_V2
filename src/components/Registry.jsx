// Model registry panel on the AI card: connect MLflow or Databricks Unity Catalog with a read-only token, see the
// registered versions and their metrics, and turn a new version into a change review.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Link2, Loader2, PlugZap, RefreshCw, Unplug } from 'lucide-react';
import { cloud } from '../lib/cloud.js';
import { callApi } from '../lib/api.js';
import { Field, Panel, Pill, fmtDate } from './ui.jsx';
import { toast } from './Extras.jsx';
import { useStore } from '../store/store.jsx';

const KIND = { mlflow: 'MLflow model registry', 'databricks-uc': 'Databricks Unity Catalog' };
const STALE_MS = 12 * 3600 * 1000;

export async function syncProduct(store, s, { quiet = false } = {}) {
  const res = await callApi('/api/connector', { action: 'sync', productId: s.id });
  const outcome = store.applyModelSync(s.id, res);
  if (!quiet || outcome !== 'same') {
    toast(outcome === 'raised' ? `New version ${res.latest} found: change review opened (stage 8)`
      : outcome === 'found' ? `New version ${res.latest} found in the registry`
        : 'Registry checked: no new version', outcome === 'same' ? 'good' : 'warn');
  }
  return outcome;
}

export default function RegistryPanel({ s }) {
  const store = useStore();
  const { role, connectModel, disconnectModel } = store;
  const c = s.connector;
  const canConnect = ['client', 'admin'].includes(role) && s.status !== 'Retired';
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const auto = useRef(false);

  // Check once when the card opens if the last check is older than 12 hours.
  useEffect(() => {
    if (!cloud || !c?.host || auto.current) return;
    if (c.lastSync && Date.now() - new Date(c.lastSync).getTime() < STALE_MS) return;
    auto.current = true;
    syncProduct(store, s, { quiet: true }).catch(() => {});
  }, [c?.host]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    setErr(''); setBusy('test');
    try {
      const result = await callApi('/api/connector', { action: 'test', productId: s.id, kind: form.kind, host: form.host, model: form.model, token: form.token });
      setBusy('seal');
      const { sealed } = form.token ? await callApi('/api/connector', { action: 'seal', productId: s.id, token: form.token }) : { sealed: '' };
      connectModel(s.id, { kind: form.kind, host: form.host.trim().replace(/\/+$/, ''), model: form.model.trim(), tokenSealed: sealed, result });
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

  const alerts = (c?.alerts || []).filter((a) => !a.raised).slice(-3).reverse();
  return (
    <Panel title={<span className="row" style={{ gap: 6 }}><PlugZap size={15} /> Model registry</span>}
      sub="Versions and metrics come straight from where the model is registered. A new version in production opens a change review."
      right={c && cloud ? <button className="btn ghost sm" onClick={sync} disabled={!!busy}>{busy === 'sync' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Check now</button> : null}>
      {!cloud && <p className="small mute">Available when GovernAI is connected to its cloud database, because the token is kept sealed on the server.</p>}
      {cloud && !c && !form && (
        <div>
          <p className="small mute">Not connected. Connect MLflow or Databricks Unity Catalog with a read-only token to keep versions and metrics up to date without copying them by hand.</p>
          {canConnect && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setForm({ kind: 'databricks-uc', host: '', model: '', token: '' })}><Link2 size={14} /> Connect a model registry</button>}
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
          {canConnect && <div><button className="btn ghost sm" onClick={() => { if (window.confirm('Disconnect the model registry? The saved token is deleted.')) disconnectModel(s.id); }}><Unplug size={14} /> Disconnect</button></div>}
        </div>
      )}
    </Panel>
  );
}
