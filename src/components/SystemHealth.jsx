// Settings > System health (administrator, signed-in mode): is the server up, what broke on people's screens lately,
// a full backup download, and the free setup steps that live outside the app.
import { useEffect, useState } from 'react';
import { Activity, Download, RefreshCw, Trash2 } from 'lucide-react';
import { Panel, Pill } from './ui.jsx';
import { cloud } from '../lib/cloud.js';
import { exportAll } from '../store/sync.js';
import { downloadJson } from '../lib/api.js';
import { BUILD } from '../lib/errors.js';
import { toast } from './Extras.jsx';

export default function SystemHealth() {
  const [health, setHealth] = useState(null);
  const [errors, setErrors] = useState(null);
  const [busy, setBusy] = useState('');
  const check = async () => {
    setHealth({ loading: true });
    try {
      const t = Date.now();
      const r = await fetch('/api/health', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      setHealth({ ...j, ok: r.ok && j.ok, roundTrip: Date.now() - t, status: r.status });
    } catch { setHealth({ ok: false, problem: 'The server did not answer' }); }
  };
  const loadErrors = async () => {
    const { data, error } = await cloud.from('v2_client_errors').select('*').order('at', { ascending: false }).limit(50);
    setErrors(error ? { error: error.message } : data || []);
  };
  useEffect(() => { check(); loadErrors(); }, []);
  const clear = async () => {
    setBusy('clear');
    const { error } = await cloud.from('v2_client_errors').delete().gte('id', 0);
    setBusy(''); if (error) toast(error.message, 'bad'); else { toast('Error reports cleared'); loadErrors(); }
  };
  const backup = async () => {
    setBusy('backup');
    try {
      const b = await exportAll(cloud);
      const rows = Object.values(b.tables).reduce((n, t) => n + (Array.isArray(t) ? t.length : 0), 0);
      downloadJson(b, `governai-backup-${b.exportedAt.slice(0, 10)}.json`);
      toast(`Backup downloaded: ${rows} rows`);
    } catch (e) { toast(e.message || 'Backup failed', 'bad'); }
    setBusy('');
  };
  const cfg = health?.configured || {};
  return (
    <Panel title="System health" sub="Whether the server and database answer, recent errors on people's screens, and backups." style={{ marginTop: 16 }}
      right={<button className="btn ghost sm" onClick={() => { check(); loadErrors(); }}><RefreshCw size={14} /> Check again</button>}>
      <div className="grid g2">
        <div>
          <div className="spread" style={{ padding: '6px 0' }}><span className="small"><Activity size={14} style={{ verticalAlign: -2 }} /> Server and database</span>
            {!health || health.loading ? <span className="xs mute">Checking…</span> : <Pill tone={health.ok ? 'good' : 'bad'}>{health.ok ? `Up, ${health.roundTrip} ms` : 'Down'}</Pill>}</div>
          {health?.problem && <p className="xs tone-bad">{health.problem}</p>}
          {health && !health.loading && (
            <ul className="health-list">
              {[['database', 'Database connection'], ['aiQuestions', 'AI-written questions (Gemini key)'], ['evidenceSigning', 'Signed evidence packs (signing key)'], ['modelConnector', 'Model registry connector (key)']].map(([k, label]) => (
                <li key={k}><span className="small">{label}</span><span className={`xs ${cfg[k] ? 'tone-good' : 'tone-warn'}`}>{cfg[k] ? 'Set up' : 'Not set up'}</span></li>
              ))}
              <li><span className="small">Server version</span><span className="xs mute num">{health.build || '—'} (this screen: {BUILD})</span></li>
            </ul>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" disabled={busy === 'backup'} onClick={backup}><Download size={15} /> {busy === 'backup' ? 'Preparing…' : 'Download a full backup'}</button>
          </div>
          <p className="xs mute" style={{ marginTop: 6 }}>Everything you can see: organisations, people's roles, products, notes, settings, the audit log and the tamper-evident record. Keep it somewhere safe; it contains client data. To restore, see "Backups" in the README.</p>
        </div>
        <div>
          <div className="spread" style={{ padding: '6px 0' }}>
            <span className="small">Errors on people's screens, last 50</span>
            {Array.isArray(errors) && errors.length > 0 && <button className="btn ghost sm" disabled={busy === 'clear'} onClick={clear}><Trash2 size={14} /> Clear</button>}
          </div>
          {errors === null ? <p className="xs mute">Loading…</p> : errors.error ? <p className="xs tone-bad">{errors.error}</p> : errors.length === 0 ? <p className="xs mute">No errors reported.</p> : (
            <ul className="error-list">
              {errors.map((e) => (
                <li key={e.id}>
                  <div className="spread"><b className="small" style={{ fontWeight: 500 }}>{e.message}</b><span className="xs mute num" style={{ whiteSpace: 'nowrap' }}>{String(e.at).slice(0, 16).replace('T', ' ')}</span></div>
                  <div className="xs mute">{e.page} · {e.role || 'unknown role'} · build {e.build || '—'}</div>
                  {e.detail && <details><summary className="xs">Details</summary><pre className="xs">{e.detail}</pre></details>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="callout" style={{ marginTop: 16 }}>
        <b className="small">Free steps outside the app</b>
        <ol className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          <li>Supabase, Authentication, Attack Protection: turn on leaked password protection.</li>
          <li>Supabase, Authentication, Emails, SMTP: connect a free email service (for example Resend), so sign-up and password emails are not held back by the built-in limit.</li>
          <li>A free uptime monitor (for example UptimeRobot) checking <code>/api/health</code> every 5 minutes, emailing you when it fails.</li>
          <li>Download a backup every week, and before any big change.</li>
        </ol>
      </div>
    </Panel>
  );
}
