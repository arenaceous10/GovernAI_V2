import { useMemo, useState } from 'react';
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { FRAMEWORKS, SELECTABLE_FRAMEWORKS, PRINCIPLES, TIER_CUTOFFS } from '../data/frameworks.js';
import { QUESTIONS, LEVEL_NAMES } from '../data/questionBank.js';
import { ROLES, STAGES } from '../data/lifecycle.js';
import { controlFor } from '../data/controls.js';
import { sectionName } from '../engine/engine.js';
import { Field, Panel, Pill } from '../components/ui.jsx';
import { useStore } from '../store/store.jsx';
import { toast } from '../components/Extras.jsx';

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const STATUS_TONE = { active: 'good', pending: 'warn', disabled: 'bad' };
const STATUS_NAME = { active: 'Active', pending: 'Waiting for approval', disabled: 'Turned off' };

// Signed-in mode: people create their own accounts; the administrator approves them and sets role and organisation.
function PersonRow({ u, clients, users = [], meId, onSave }) {
  const [role, setRole] = useState(u.role || (u.side === 'team' ? u.requestedRole || 'assessor' : 'client'));
  const [clientId, setClientId] = useState(u.clientId || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const self = u.id === meId;
  const changed = role !== u.role || (role === 'client' && clientId !== (u.clientId || ''));
  const save = async (patch) => { setBusy(true); const e = await onSave(u.id, patch); setErr(e); setBusy(false); if (!e) toast(patch.status === 'disabled' ? `${u.name}'s access turned off` : patch.status === 'active' ? `${u.name} approved` : 'Access saved'); };
  const valid = role !== 'client' || clientId;
  return (
    <tr>
      <td><b style={{ fontWeight: 500 }}>{u.name}</b><div className="xs mute">{u.email}</div></td>
      <td className="small">{u.side === 'team' ? `Governance team${u.requestedRole ? ` (asked for ${ROLES[u.requestedRole]?.name.toLowerCase()})` : ''}` : `Client${u.company ? `: ${u.company}` : ''}`}
        {u.side !== 'team' && u.status === 'pending' && u.clientId && (() => {
          const members = users.filter((x) => x.id !== u.id && x.clientId === u.clientId && x.status === 'active').length;
          return <div className="xs mute">{members ? `Joins an organisation with ${members} active member${members > 1 ? 's' : ''}` : 'New organisation, created at sign-up. Check this person really represents it.'}</div>;
        })()}
      </td>
      <td>
        <select className="input" aria-label={`Role for ${u.name}`} style={{ width: 190, padding: '5px 8px' }} value={role} disabled={self || busy} onChange={(e) => setRole(e.target.value)}>
          {Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.name}</option>)}
        </select>
        {role === 'client' && (
          <select className="input" aria-label={`Organisation for ${u.name}`} style={{ width: 190, padding: '5px 8px', marginTop: 6 }} value={clientId} disabled={self || busy} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Choose organisation…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </td>
      <td><Pill tone={STATUS_TONE[u.status]}>{STATUS_NAME[u.status]}</Pill>{err && <div className="xs tone-bad" style={{ marginTop: 4 }}>{err}</div>}</td>
      <td>
        {self ? <span className="xs mute">You</span> : (
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            {u.status !== 'active' && <button className="btn primary sm" disabled={busy || !valid} onClick={() => save({ role, clientId: role === 'client' ? clientId : null, status: 'active' })}>Approve</button>}
            {u.status === 'active' && changed && <button className="btn sm" disabled={busy || !valid} onClick={() => save({ role, clientId: role === 'client' ? clientId : null })}>Save</button>}
            {u.status === 'active' && <button className="btn ghost sm" disabled={busy} onClick={() => save({ status: 'disabled' })}>Turn off</button>}
          </div>
        )}
      </td>
    </tr>
  );
}

function People() {
  const { state, updatePerson, me } = useStore();
  const pending = state.users.filter((u) => u.status === 'pending');
  const rest = state.users.filter((u) => u.status !== 'pending');
  const table = (rows) => (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Person</th><th>Signed up as</th><th>Role and organisation</th><th>Access</th><th /></tr></thead>
        <tbody>{rows.map((u) => <PersonRow key={`${u.id}-${u.status}-${u.role}-${u.clientId}`} u={u} clients={state.clients} users={state.users} meId={me?.id} onSave={updatePerson} />)}</tbody>
      </table>
    </div>
  );
  return (
    <>
      <Panel title="Waiting for approval" sub="Governance team accounts, and people joining an organisation that already exists." style={{ marginTop: 16 }}>
        {pending.length ? table(pending) : <div className="empty-sm">No one is waiting.</div>}
      </Panel>
      <Panel title="People" sub="Everyone signs up themselves. Roles are set here, and nobody can change their own." style={{ marginTop: 16 }}>
        {rest.length ? table(rest) : <div className="empty-sm">No one yet.</div>}
      </Panel>
    </>
  );
}

// One organisation: view, edit in place, or delete with a clear account of what goes with it.
function ClientRow({ c }) {
  const { state, updateClient, deleteClient } = useStore();
  const [mode, setMode] = useState('view');   // view | edit | delete
  const [f, setF] = useState({ name: c.name, sector: c.sector || '', contact: c.contact || '' });
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const products = state.systems.filter((x) => x.clientId === c.id);
  const live = products.filter((x) => x.status !== 'Draft').length;
  const people = state.users.filter((u) => u.clientId === c.id).length;
  const needsName = products.length > 0 || people > 0;
  const save = () => { const e = updateClient(c.id, f); setErr(e); if (!e) { setMode('view'); toast(`${f.name.trim()} saved`); } };
  const remove = async () => { setBusy(true); const e = await deleteClient(c.id); setBusy(false); if (e) setErr(e); else toast(`${c.name} deleted`, 'warn'); };
  if (mode === 'edit') {
    return (
      <tr className="row-edit">
        <td><input className="input" aria-label="Edit organisation name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></td>
        <td><input className="input" aria-label="Edit sector" value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })} /></td>
        <td><input className="input" aria-label="Edit main contact" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></td>
        <td className="num">{live}</td>
        <td>
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <button className="btn primary sm" onClick={save}>Save</button>
            <button className="btn ghost sm" onClick={() => { setMode('view'); setErr(''); setF({ name: c.name, sector: c.sector || '', contact: c.contact || '' }); }}>Cancel</button>
          </div>
          {err && <div className="xs tone-bad" role="alert" style={{ marginTop: 4 }}>{err}</div>}
        </td>
      </tr>
    );
  }
  return (
    <>
      <tr>
        <td><b style={{ fontWeight: 500 }}>{c.name}</b></td><td className="small">{c.sector}</td><td className="small">{c.contact}</td><td className="num">{live}</td>
        <td>
          <div className="row" style={{ gap: 4, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
            <button className="btn ghost sm" aria-label={`Edit ${c.name}`} onClick={() => { setMode('edit'); setErr(''); }}><Pencil size={14} /></button>
            <button className="btn ghost sm" aria-label={`Delete ${c.name}`} onClick={() => { setMode(mode === 'delete' ? 'view' : 'delete'); setTyped(''); setErr(''); }}><Trash2 size={14} /></button>
          </div>
        </td>
      </tr>
      {mode === 'delete' && (
        <tr className="row-confirm">
          <td colSpan={5}>
            <div className="confirm-box fade-in" role="alertdialog" aria-label={`Delete ${c.name}`}>
              <b>Delete {c.name}?</b>
              <p className="small">
                {products.length ? `${products.length} product${products.length === 1 ? '' : 's'} and ${products.length === 1 ? 'its' : 'their'} evidence and notes will be deleted. ` : 'It has no products. '}
                {people ? `${people} ${people === 1 ? 'person goes' : 'people go'} back to waiting for approval, so you can move them to another organisation. ` : ''}
                The audit log keeps a record. This cannot be undone.
              </p>
              {needsName && <label className="field" style={{ maxWidth: 360 }}><span className="small">Type <b>{c.name}</b> to confirm</span><input className="input" aria-label="Type the organisation name to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} /></label>}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn danger" disabled={busy || (needsName && typed.trim() !== c.name)} onClick={remove}>{busy ? 'Deleting…' : 'Delete organisation'}</button>
                <button className="btn ghost" onClick={() => setMode('view')}>Keep it</button>
              </div>
              {err && <div className="xs tone-bad" role="alert" style={{ marginTop: 6 }}>{err}</div>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function AdminClients() {
  const { state, addClient, addUser, removeUser, sync } = useStore();
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
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Client</th><th>Sector</th><th>Main contact</th><th>Products</th><th /></tr></thead>
              <tbody>{state.clients.map((x) => <ClientRow key={x.id} c={x} />)}</tbody>
            </table>
          </div>
          {state.clients.length === 0 && <div className="empty-sm">No client organisations yet.</div>}
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
      {sync.mode === 'cloud' ? <People /> : <Panel title="Users" style={{ marginTop: 16 }}>
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
      </Panel>}
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

const BLANK_Q = { section: 'RAI', ref: '', topic: '', principle: 'accountability', kind: 'core', weight: 2, q: '', options: ['', '', '', ''], naOn: false, na: '', action: '', keywords: '' };
const WEIGHTS = [[3, 'Critical'], [2, 'Standard'], [1, 'Supporting']];

// Add or edit an administrator's own question. Scoring comes from the option position, as for every question.
function QuestionForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(() => (initial ? { ...BLANK_Q, ...initial, naOn: !!initial.na, keywords: (initial.keywords || []).join(', ') } : BLANK_Q));
  const [tried, setTried] = useState(false);
  const up = (p) => setF((x) => ({ ...x, ...p }));
  const missing = [
    !f.q.trim() && 'the question',
    f.options.some((o) => !o.trim()) && 'all four options',
    new Set(f.options.map((o) => o.trim().toLowerCase())).size < 4 && f.options.every((o) => o.trim()) && 'four different options',
    !f.topic.trim() && 'a short topic',
    f.naOn && !f.na.trim() && 'the "Not applicable" wording',
  ].filter(Boolean);
  const save = () => {
    setTried(true);
    if (missing.length) return;
    onSave({
      id: initial?.id, active: initial?.active !== false, section: f.section, ref: f.ref.trim(), topic: f.topic.trim(), principle: f.principle,
      kind: f.kind, weight: +f.weight, q: f.q.trim(), options: f.options.map((o) => o.trim()), na: f.naOn ? f.na.trim() : '',
      action: f.action.trim(), keywords: f.keywords.split(',').map((k) => k.trim()).filter(Boolean),
    });
  };
  return (
    <section className="panel qform fade-in">
      <div className="panel-head"><div><h2>{initial ? `Edit ${initial.id}` : 'Add a question'}</h2><p>Used in new assessments. Assessments already done keep the wording they were scored with.</p></div></div>
      <div className="grid g3">
        <Field label="Section"><select className="input" aria-label="Section" value={f.section} onChange={(e) => up({ section: e.target.value })}>{[...SELECTABLE_FRAMEWORKS, 'RAI', 'DG'].map((k) => <option key={k} value={k}>{sectionName(k)}</option>)}</select></Field>
        <Field label="Responsible AI principle"><select className="input" aria-label="Responsible AI principle" value={f.principle} onChange={(e) => up({ principle: e.target.value })}>{Object.entries(PRINCIPLES).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}</select></Field>
        <Field label="Reference" hint="Article or clause, if any"><input className="input" value={f.ref} onChange={(e) => up({ ref: e.target.value })} placeholder="e.g. Art. 14" /></Field>
        <Field label="Topic"><input className="input" value={f.topic} onChange={(e) => up({ topic: e.target.value })} placeholder="e.g. Model inventory" /></Field>
        <Field label="When it is asked">
          <select className="input" aria-label="When it is asked" value={f.kind} onChange={(e) => up({ kind: e.target.value })}>
            <option value="core">Every time this section is in scope</option>
            <option value="adaptive">Tailored pool: picked when relevant</option>
          </select>
        </Field>
        <Field label="Importance"><select className="input" aria-label="Importance" value={f.weight} onChange={(e) => up({ weight: +e.target.value })}>{WEIGHTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      </div>
      <div className="stack" style={{ marginTop: 14 }}>
        <Field label="Question" hint="Use {subject} for the people the domain affects, e.g. policyholders."><textarea className="input" rows={2} value={f.q} onChange={(e) => up({ q: e.target.value })} /></Field>
        <div className="grid g2">
          {f.options.map((o, i) => (
            <Field key={i} label={`Option ${i + 1}: ${LEVEL_NAMES[i]} (${[0, 35, 70, 100][i]} points)`}>
              <input className="input" value={o} onChange={(e) => up({ options: f.options.map((x, k) => (k === i ? e.target.value : x)) })} placeholder={['Weakest answer', 'Partly there', 'In place', 'Strongest answer'][i]} />
            </Field>
          ))}
        </div>
        <label className="row small" style={{ cursor: 'pointer' }}><input type="checkbox" checked={f.naOn} onChange={(e) => up({ naOn: e.target.checked })} /> Offer "Not applicable" (left out of the score)</label>
        {f.naOn && <Field label="Not applicable wording"><input className="input" value={f.na} onChange={(e) => up({ na: e.target.value })} placeholder="e.g. We do not use third-party models" /></Field>}
        <Field label="Action when the answer is weak" hint="Shown to the client as a follow-up action."><input className="input" value={f.action} onChange={(e) => up({ action: e.target.value })} /></Field>
        {f.kind === 'adaptive' && <Field label="Keywords" hint="Comma separated. Ranked higher when the product description mentions them."><input className="input" value={f.keywords} onChange={(e) => up({ keywords: e.target.value })} placeholder="e.g. chatbot, vendor" /></Field>}
      </div>
      {tried && missing.length > 0 && <div className="callout warn small" role="alert" style={{ marginTop: 12 }}>Still needed: {missing.join(', ')}.</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" onClick={save}>{initial ? 'Save changes' : 'Add question'}</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

function CustomRow({ c, onEdit }) {
  const { saveCustomQuestion, removeCustomQuestion } = useStore();
  const [confirm, setConfirm] = useState(false);
  const off = c.active === false;
  return (
    <div className={`q-review ${off ? 'is-off' : ''}`}>
      <div><div className="small">{c.q}</div><div className="xs mute" style={{ marginTop: 4 }}>{c.options.join(' / ')}</div></div>
      <div className="xs">
        <div><b>{c.id}</b> {c.kind === 'core' ? 'Asked every time' : 'Tailored pool'}, {WEIGHTS.find(([v]) => v === +c.weight)?.[1].toLowerCase()}</div>
        <div className="mute">{PRINCIPLES[c.principle]?.name}</div>
        <div className="mute">{sectionName(c.section)}{c.ref ? ` ${c.ref}` : ''}</div>
        <div className="row" style={{ gap: 4, marginTop: 4 }}><Pill tone="ok">Added by admin</Pill>{off && <Pill>Turned off</Pill>}</div>
      </div>
      <div />
      <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
        {confirm ? (
          <><button className="btn danger sm" onClick={() => removeCustomQuestion(c.id)}>Delete</button><button className="btn ghost sm" onClick={() => setConfirm(false)}>Keep</button></>
        ) : (
          <>
            <button className="btn sm" onClick={onEdit}><Pencil size={13} /> Edit</button>
            <button className="btn ghost sm" onClick={() => saveCustomQuestion({ ...c, active: off })}>{off ? 'Turn on' : 'Turn off'}</button>
            <button className="btn ghost sm" aria-label={`Delete ${c.id}`} onClick={() => setConfirm(true)}><Trash2 size={13} /></button>
          </>
        )}
      </div>
    </div>
  );
}

export function AdminBank() {
  const { state, saveCustomQuestion } = useStore();
  const [sec, setSec] = useState('');
  const [kind, setKind] = useState('core');
  const [qq, setQq] = useState('');
  const [form, setForm] = useState(null);   // null | 'new' | question
  const custom = state.settings.customQuestions || [];
  const match = (q, section) => (!sec || section === sec) && (!kind || q.kind === kind)
    && (!qq || `${q.id} ${q.q} ${q.topic}`.toLowerCase().includes(qq.toLowerCase()));
  const rows = useMemo(() => QUESTIONS.filter((q) => match(q, Object.keys(q.maps)[0])), [sec, kind, qq]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = custom.filter((c) => match(c, c.section));
  return (
    <div>
      <div className="page-head">
        <div><h1>Question bank</h1><p>Add your own questions or edit wording. Changes apply to new assessments.</p></div>
        {!form && <button className="btn primary" onClick={() => setForm('new')}><Plus size={16} /> Add a question</button>}
      </div>
      {form && <QuestionForm key={form === 'new' ? 'new' : form.id} initial={form === 'new' ? null : form} onCancel={() => setForm(null)} onSave={(q) => { saveCustomQuestion(q); setForm(null); toast(q.id ? 'Question saved' : 'Question added'); }} />}
      <Panel style={form ? { marginTop: 16 } : undefined}>
        <div className="grid g3" style={{ marginBottom: 12 }}>
          <Field label="Section"><select className="input" value={sec} onChange={(e) => setSec(e.target.value)}><option value="">All sections</option>{[...SELECTABLE_FRAMEWORKS, 'RAI', 'DG'].map((k) => <option key={k} value={k}>{sectionName(k)}</option>)}</select></Field>
          <Field label="Type"><select className="input" value={kind} onChange={(e) => setKind(e.target.value)}><option value="core">Fixed</option><option value="adaptive">Tailored pool</option><option value="">Both</option></select></Field>
          <Field label="Search"><input className="input" value={qq} onChange={(e) => setQq(e.target.value)} placeholder="ID, topic or wording" /></Field>
        </div>
        {mine.length > 0 && (
          <>
            <h3 style={{ margin: '4px 0 2px' }}>Your questions</h3>
            <div className="xs mute" style={{ marginBottom: 6 }}>{mine.length} added by an administrator</div>
            {mine.map((c) => <CustomRow key={c.id} c={c} onEdit={() => { setForm(c); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />)}
            <hr className="sep" />
          </>
        )}
        <div className="xs mute" style={{ marginBottom: 6 }}>{rows.length} built-in question{rows.length === 1 ? '' : 's'}</div>
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
            <p className="small mute" style={{ marginTop: 8 }}><b>What the AI receives:</b> the type of AI, domain, sourcing, countries, data categories, risk flags, the chosen frameworks and the description with names, emails, phone numbers, ID numbers, account numbers, addresses and links removed. It never receives the product name, owner, business unit, organisation, people, datasets, evidence or answers.</p>
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
      <ChecklistRules />
    </div>
  );
}

// Which lifecycle checks are mandatory. Default follows the control library; High-risk products make more checks mandatory.
function ChecklistRules() {
  const { state, setSetting } = useStore();
  const rules = state.settings.checklistRules || {};
  const [stage, setStage] = useState(1);
  const st = STAGES[stage - 1];
  const set = (item, v) => { const next = { ...rules }; if (v) next[item] = v; else delete next[item]; setSetting('checklistRules', next); };
  const def = (item) => { const c = controlFor(item); return c.mandatory ? 'Mandatory' : c.highRisk ? 'Mandatory for High risk' : 'Optional'; };
  return (
    <Panel title="Checklist rules" sub="Mandatory checks must be ticked before a stage is submitted. Optional checks can be skipped with a reason, which the reviewer sees." style={{ marginTop: 16 }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <label className="field" style={{ minWidth: 260 }}><span>Stage</span>
          <select className="input" value={stage} onChange={(e) => setStage(+e.target.value)}>{STAGES.map((x) => <option key={x.n} value={x.n}>{x.n}. {x.name}</option>)}</select>
        </label>
        <span className="xs mute">{Object.keys(rules).length} changed from the default</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Check</th><th>Control</th><th>Default</th><th>Rule</th></tr></thead>
          <tbody>
            {st.checklist.map((item) => (
              <tr key={item}>
                <td className="small" style={{ maxWidth: 420 }}>{item}</td>
                <td className="small"><span className="ci-tag ctl">{controlFor(item).id}</span> {controlFor(item).name}</td>
                <td className="small mute">{def(item)}</td>
                <td>
                  <select className="input" aria-label={`Rule for ${item}`} style={{ width: 150, padding: '5px 8px' }} value={rules[item] || ''} onChange={(e) => set(item, e.target.value)}>
                    <option value="">Default</option><option value="mandatory">Always mandatory</option><option value="optional">Always optional</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
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
