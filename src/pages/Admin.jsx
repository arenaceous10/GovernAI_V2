import { useMemo, useState } from 'react';
import { Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { FRAMEWORKS, SELECTABLE_FRAMEWORKS, PRINCIPLES, TIER_CUTOFFS } from '../data/frameworks.js';
import { QUESTIONS, LEVEL_NAMES } from '../data/questionBank.js';
import { ROLES } from '../data/lifecycle.js';
import { sectionName } from '../engine/engine.js';
import { Field, Panel, Pill } from '../components/ui.jsx';
import { useStore } from '../store/store.jsx';

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export function AdminClients() {
  const { state, addClient, addUser, removeUser } = useStore();
  const [c, setC] = useState({ name: '', sector: '', contact: '' });
  const [u, setU] = useState({ name: '', email: '', role: 'client', clientId: state.clients[0]?.id || '' });
  const [err, setErr] = useState('');
  const count = (id) => state.systems.filter((s) => s.clientId === id && s.status !== 'Draft').length;
  function onAddUser() {
    if (!u.name.trim() || !emailOk(u.email)) { setErr('Enter a name and a valid email address.'); return; }
    if (state.users.some((x) => x.email.toLowerCase() === u.email.trim().toLowerCase())) { setErr('A user with this email already exists.'); return; }
    addUser({ ...u, name: u.name.trim(), email: u.email.trim(), clientId: u.role === 'client' ? u.clientId : undefined });
    setU({ ...u, name: '', email: '' }); setErr('');
  }
  return (
    <div>
      <div className="page-head"><div><h1>Clients and users</h1><p>Client users see only their own organisation.</p></div></div>
      <div className="grid g-wide">
        <Panel title="Client organisations">
          <table className="table">
            <thead><tr><th>Client</th><th>Sector</th><th>Main contact</th><th>Assessments</th></tr></thead>
            <tbody>{state.clients.map((x) => <tr key={x.id}><td><b style={{ fontWeight: 500 }}>{x.name}</b></td><td className="small">{x.sector}</td><td className="small">{x.contact}</td><td className="num">{count(x.id)}</td></tr>)}</tbody>
          </table>
        </Panel>
        <Panel title="Add a client">
          <div className="stack">
            <Field label="Organisation name"><input className="input" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
            <Field label="Sector"><input className="input" value={c.sector} onChange={(e) => setC({ ...c, sector: e.target.value })} /></Field>
            <Field label="Main contact"><input className="input" value={c.contact} onChange={(e) => setC({ ...c, contact: e.target.value })} /></Field>
            <button className="btn primary" disabled={!c.name.trim() || state.clients.some((x) => x.name.toLowerCase() === c.name.trim().toLowerCase())} onClick={() => { addClient({ ...c, name: c.name.trim() }); setC({ name: '', sector: '', contact: '' }); }}>Add client</button>
          </div>
        </Panel>
      </div>
      <Panel title="Users" style={{ marginTop: 16 }}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Organisation</th><th /></tr></thead>
            <tbody>
              {state.users.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td><td className="small">{x.email}</td><td className="small">{ROLES[x.role]?.name}</td>
                  <td className="small">{x.role === 'client' ? state.clients.find((k) => k.id === x.clientId)?.name : 'Governance team'}</td>
                  <td><button className="btn ghost sm" aria-label={`Remove ${x.name}`} disabled={x.role === 'admin' && state.users.filter((y) => y.role === 'admin').length === 1} onClick={() => removeUser(x.id)}><Trash2 size={14} /> Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <hr className="sep" />
        <h3 style={{ marginBottom: 10 }}>Add a user</h3>
        {err && <div className="callout bad" style={{ marginBottom: 10 }}>{err}</div>}
        <div className="grid g4" style={{ alignItems: 'end' }}>
          <Field label="Name"><input className="input" value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} /></Field>
          <Field label="Role"><select className="input" value={u.role} onChange={(e) => setU({ ...u, role: e.target.value })}>{Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.name}</option>)}</select></Field>
          {u.role === 'client'
            ? <Field label="Organisation"><select className="input" value={u.clientId} onChange={(e) => setU({ ...u, clientId: e.target.value })}>{state.clients.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></Field>
            : <div className="small mute" style={{ paddingBottom: 10 }}>Governance team users see all clients.</div>}
        </div>
        <button className="btn primary" style={{ marginTop: 12 }} onClick={onAddUser}>Add user</button>
        
      </Panel>
    </div>
  );
}

function BankRow({ q }) {
  const { state, setOverride, clearOverride } = useStore();
  const o = state.bankOverrides?.[q.id];
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(o?.q || q.q);
  const [opts, setOpts] = useState(o?.options || q.options);
  const valid = text.trim().length >= 10 && opts.every((x) => x.trim()) && new Set(opts.map((x) => x.trim().toLowerCase())).size === 4;
  return (
    <div className="q-review" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) 140px' }}>
      <div>
        {edit ? (
          <div className="stack">
            <Field label="Question wording"><textarea className="input" style={{ minHeight: 60 }} value={text} onChange={(e) => setText(e.target.value)} /></Field>
            <div className="grid g2" style={{ gap: 8 }}>
              {opts.map((x, i) => <Field key={i} label={`Option ${i + 1}: ${LEVEL_NAMES[i]}`}><input className="input" value={x} onChange={(e) => setOpts(opts.map((y, k) => (k === i ? e.target.value : y)))} /></Field>)}
            </div>
            <p className="xs mute">Wording only. The score for each option is fixed by its position. Use {'{subject}'} for the people the domain affects.</p>
            <div className="row">
              <button className="btn primary sm" disabled={!valid} onClick={() => { setOverride(q.id, { q: text.trim(), options: opts.map((x) => x.trim()) }); setEdit(false); }}>Save wording</button>
              <button className="btn sm" onClick={() => { setText(o?.q || q.q); setOpts(o?.options || q.options); setEdit(false); }}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="small">{o?.q || q.q}</div>
            <div className="xs mute" style={{ marginTop: 4 }}>{(o?.options || q.options).join(' / ')}</div>
          </>
        )}
      </div>
      <div className="xs">
        <div><b>{q.id}</b> {q.kind === 'core' ? 'Fixed' : 'Tailored pool'}, weight {q.weight}</div>
        <div className="mute">{PRINCIPLES[q.principle]?.name}</div>
        <div className="mute">{Object.entries(q.maps).map(([k, v]) => `${sectionName(k)} ${v}`).join('; ')}</div>
        {o && <Pill tone="ok">Edited</Pill>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {!edit && <button className="btn sm" onClick={() => setEdit(true)}><Pencil size={13} /> Edit</button>}
        {o && !edit && <button className="btn ghost sm" aria-label={`Reset ${q.id}`} onClick={() => { clearOverride(q.id); setText(q.q); setOpts(q.options); }}><RotateCcw size={13} /> Reset</button>}
      </div>
    </div>
  );
}

export function AdminBank() {
  const [sec, setSec] = useState('');
  const [kind, setKind] = useState('core');
  const [qq, setQq] = useState('');
  const rows = useMemo(() => QUESTIONS.filter((q) => (!sec || Object.keys(q.maps)[0] === sec) && (!kind || q.kind === kind)
    && (!qq || `${q.id} ${q.q} ${q.topic}`.toLowerCase().includes(qq.toLowerCase()))), [sec, kind, qq]);
  return (
    <div>
      <div className="page-head"><div><h1>Question bank</h1><p>Wording edits apply to new assessments.</p></div></div>
      <Panel>
        <div className="grid g3" style={{ marginBottom: 12 }}>
          <Field label="Section"><select className="input" value={sec} onChange={(e) => setSec(e.target.value)}><option value="">All sections</option>{[...SELECTABLE_FRAMEWORKS, 'RAI', 'DG'].map((k) => <option key={k} value={k}>{sectionName(k)}</option>)}</select></Field>
          <Field label="Type"><select className="input" value={kind} onChange={(e) => setKind(e.target.value)}><option value="core">Fixed</option><option value="adaptive">Tailored pool</option><option value="">Both</option></select></Field>
          <Field label="Search"><input className="input" value={qq} onChange={(e) => setQq(e.target.value)} placeholder="ID, topic or wording" /></Field>
        </div>
        <div className="xs mute" style={{ marginBottom: 6 }}>{rows.length} question{rows.length === 1 ? '' : 's'}</div>
        {rows.map((q) => <BankRow key={q.id} q={q} />)}
      </Panel>
    </div>
  );
}

export function AdminSettings() {
  const { state, setSetting, resetDemo } = useStore();
  const [confirm, setConfirm] = useState(false);
  const en = state.settings.enabledFrameworks || SELECTABLE_FRAMEWORKS;
  return (
    <div>
      <div className="page-head"><div><h1>Settings</h1></div></div>
      <div className="grid g2">
        <Panel title="Frameworks offered to clients" sub="Turned-off frameworks stop appearing in new assessments. Existing assessments are not changed.">
          {SELECTABLE_FRAMEWORKS.map((k) => (
            <label key={k} className="row" style={{ padding: '8px 0', cursor: 'pointer', alignItems: 'flex-start' }}>
              <input type="checkbox" checked={en.includes(k)} disabled={en.length === 1 && en.includes(k)} onChange={(e) => setSetting('enabledFrameworks', e.target.checked ? [...en, k] : en.filter((x) => x !== k))} style={{ marginTop: 4 }} />
              <span><b style={{ fontWeight: 500 }}>{FRAMEWORKS[k].name}</b><div className="xs mute">{FRAMEWORKS[k].full}</div></span>
            </label>
          ))}
          <p className="xs mute">At least one framework stays on. The Responsible AI baseline and data governance are always included.</p>
        </Panel>
        <div className="stack">
          <Panel title="Tailored questions" sub="Where the 20 to 30% tailored questions come from.">
            <label className="row" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={state.settings.aiQuestions} onChange={(e) => setSetting('aiQuestions', e.target.checked)} />
              Use AI (Gemini, through /api/generate-questions) when it is available
            </label>
            <p className="small mute" style={{ marginTop: 8 }}>The AI writes only within the frameworks the client chose; anything citing another law is dropped. If the AI is off or unreachable, the rules engine picks from {QUESTIONS.filter((q) => q.kind === 'adaptive').length} pool questions. Scores always come from the option position.</p>
          </Panel>
          <CutoffEditor />
          <Panel title="Demo data" sub="Data is stored in this browser only.">
            {confirm ? (
              <div className="row"><span className="small">Replace all data with the demo portfolio?</span>
                <button className="btn danger" onClick={() => { resetDemo(); setConfirm(false); }}>Yes, reset</button>
                <button className="btn" onClick={() => setConfirm(false)}>Cancel</button></div>
            ) : <button className="btn danger" onClick={() => setConfirm(true)}>Reset to demo data</button>}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function CutoffEditor() {
  const { state, setSetting } = useStore();
  const saved = state.settings.cutoffs || {};
  const keys = [...SELECTABLE_FRAMEWORKS, 'DEFAULT'];
  const [v, setV] = useState(() => Object.fromEntries(keys.map((k) => [k, { ...(saved[k] || TIER_CUTOFFS[k]) }])));
  const ok = keys.every((k) => v[k].limited > 0 && v[k].limited < v[k].high && v[k].high <= 100);
  const set = (k, f, x) => setV({ ...v, [k]: { ...v[k], [f]: Number(x) } });
  return (
    <Panel title="Tier cut-offs" sub="Applied to new assessments and re-assessments.">
      <table className="table">
        <thead><tr><th>Framework</th><th>Limited from</th><th>High from</th></tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <td className="small">{k === 'DEFAULT' ? 'No framework' : FRAMEWORKS[k].name}</td>
              {['limited', 'high'].map((f) => <td key={f}><input className="input" type="number" min="1" max="100" aria-label={`${k} ${f}`} style={{ width: 80, padding: '5px 8px' }} value={v[k][f]} onChange={(e) => set(k, f, e.target.value)} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {!ok && <p className="xs tone-bad" style={{ marginTop: 6 }}>Limited must be above 0 and below High; High at most 100.</p>}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary sm" disabled={!ok} onClick={() => setSetting('cutoffs', v)}>Save cut-offs</button>
        <button className="btn ghost sm" onClick={() => { const d = Object.fromEntries(keys.map((k) => [k, { ...TIER_CUTOFFS[k] }])); setV(d); setSetting('cutoffs', {}); }}>Restore defaults</button>
      </div>
    </Panel>
  );
}
