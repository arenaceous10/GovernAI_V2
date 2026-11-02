import { useState } from 'react';
import { ArrowLeft, Check, CheckCircle2, ChevronDown, Circle, CornerDownLeft, Download, ExternalLink, Gavel, Link2, Loader2, Lock, Paperclip, RefreshCw, Send, ShieldCheck, X } from 'lucide-react';
import { uploadEvidence, evidenceUrl, removeEvidence, hasFile, isLink, fmtSize } from '../lib/files.js';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TIERS, DOMAINS, SYSTEM_TYPES, SOURCING, PRINCIPLES } from '../data/frameworks.js';
import { geoName } from '../data/countries.js';
import { STAGES, stageOf, requiredApprovals, ROLES, STAGE_STATUS, GATE_STAGES, ON_DEMAND, phaseOf } from '../data/lifecycle.js';
import { LEVEL_NAMES } from '../data/questionBank.js';
import { sectionOf, sectionOrder } from '../engine/engine.js';
import { downloadReport } from '../engine/report.js';
import { Panel, Pill, Tabs, TierBadge, fmtDate, StatusPill, Field } from '../components/ui.jsx';
import { LifecycleRail, Ring } from '../components/Stages.jsx';
import Results, { fwName } from '../components/Results.jsx';
import DataAssets, { catalogCoverage } from '../components/DataAssets.jsx';
import LineageGraph from '../components/LineageGraph.jsx';
import { useStore, stageBlockers, waitingOn, newStage, CAN } from '../store/store.jsx';

const label = (list, id) => list.find((x) => x.id === id)?.label || id || '—';

// Opens a stored file in a new tab. The tab is opened before the signed link is fetched so pop-up blockers allow it.
async function openFile(v, setErr) {
  setErr('');
  const w = window.open('', '_blank');
  try {
    let url = await evidenceUrl(v);
    if (url?.startsWith('data:')) url = URL.createObjectURL(await (await fetch(url)).blob());
    if (w) w.location.href = url; else window.location.assign(url);
  } catch (e) {
    if (w) w.close();
    setErr(e.message || 'Could not open the file.');
  }
}

function EvidenceItem({ item, value, editable, onSave, systemId, stage }) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState(value?.ref || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const has = value && (value.ref || value.file);
  const stored = hasFile(value);

  const upload = async (f) => {
    setBusy(true); setErr('');
    try {
      const up = await uploadEvidence(f, { systemId, stage });
      if (value?.path && value.path !== up.path) removeEvidence(value);
      onSave({ ref: ref.trim(), ...up, at: new Date().toISOString() });
      setOpen(false);
    } catch (e) {
      setErr(e.message || 'Upload failed.');
    } finally { setBusy(false); }
  };
  const saveLink = () => {
    const keep = value && value.file ? { file: value.file, path: value.path, data: value.data, size: value.size, type: value.type } : { file: '' };
    onSave({ ...keep, ref: ref.trim(), at: new Date().toISOString() });
    setOpen(false);
  };
  const remove = () => { removeEvidence(value); onSave(null); };

  return (
    <div className="ev-row">
      <div style={{ minWidth: 0 }}>
        <div>{item}</div>
        {has && !open && (
          <div className="ev-links">
            {value.file && (stored
              ? <button type="button" className="linkbtn xs" onClick={() => openFile(value, setErr)} title="Open file"><Paperclip size={11} /> {value.file}{value.size ? <span className="mute"> · {fmtSize(value.size)}</span> : null} <ExternalLink size={11} /></button>
              : <span className="xs mute"><Paperclip size={11} /> {value.file} · no file uploaded</span>)}
            {value.ref && (isLink(value.ref)
              ? <a className="linkbtn xs" href={value.ref} target="_blank" rel="noopener noreferrer"><Link2 size={11} /> {value.ref} <ExternalLink size={11} /></a>
              : <span className="xs mute"><Link2 size={11} /> {value.ref}</span>)}
          </div>
        )}
        {open && (
          <div className="row" style={{ marginTop: 8 }}>
            <input className="input" style={{ flex: 1, minWidth: 200 }} aria-label={`Link or document name for ${item}`} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Link or document name" disabled={busy} />
            <label className={`btn sm${busy ? ' disabled' : ''}`} style={{ cursor: busy ? 'wait' : 'pointer' }} aria-disabled={busy}>{busy ? <><Loader2 size={13} className="spin" /> Uploading</> : 'Upload file'}
              <input type="file" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
            </label>
            <button type="button" className="btn primary sm" disabled={busy || !ref.trim()} onClick={saveLink}>Save</button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => { setOpen(false); setErr(''); }}>Cancel</button>
          </div>
        )}
        {err && <div className="xs" role="alert" style={{ color: 'var(--bad)', marginTop: 4 }}>{err}</div>}
      </div>
      <div className="row" style={{ gap: 6 }}>
        {has ? <Pill tone="good">Attached</Pill> : <Pill>Not attached</Pill>}
        {editable && !open && <button type="button" className="btn sm" onClick={() => { setRef(value?.ref || ''); setErr(''); setOpen(true); }}>{has ? 'Change' : 'Attach'}</button>}
        {editable && has && !open && <button type="button" className="btn ghost sm" aria-label={`Remove evidence for ${item}`} onClick={remove}><X size={14} /></button>}
      </div>
    </div>
  );
}

const OUTCOME_TONE = { Approved: 'good', 'Approved with conditions': 'good', Returned: 'warn', Submitted: 'ok', Overridden: 'bad' };
const WHO = { client: 'Client', assessor: 'Governance reviewer', lead: 'Governance lead' };

// Decision panel for the reviewer or lead whose sign-off is needed.
function ReviewBox({ s, n, rec }) {
  const { role, reviewStage } = useStore();
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState('');
  const tier = s.assessment.results.tier;
  const need = requiredApprovals(n, tier);
  const waiting = waitingOn(s);
  const mySlot = waiting.includes(role) ? role : (role === 'lead' && waiting.includes('assessor') && !need.includes('lead') ? 'lead' : null);
  if (!mySlot) return null;
  const st = stageOf(n);
  const done = st.checklist.filter((i) => rec.checklist[i]).length + st.evidence.filter((i) => rec.evidence[i]).length;
  const decide = (outcome) => { reviewStage(s.id, n, mySlot, outcome, comment.trim(), internal.trim()); setComment(''); setInternal(''); };
  return (
    <section className="panel decision">
      <div className="decision-head"><Gavel size={16} /> <h2>Your decision</h2></div>
      <p className="small mute">{done} of {st.checklist.length + st.evidence.length} items completed by the client.{rec.note ? ` Note: "${rec.note}"` : ''}</p>
      <Field label="Comment to the client"><textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Needed to return or add conditions" /></Field>
      <Field label={<span className="row" style={{ gap: 6 }}><Lock size={13} /> Internal note</span>} hint="Only the governance team sees this."><textarea className="input internal" rows={2} value={internal} onChange={(e) => setInternal(e.target.value)} /></Field>
      <div className="decision-actions">
        <button className="btn primary" onClick={() => decide('Approved')}><CheckCircle2 size={15} /> Approve</button>
        {(n === 6 || GATE_STAGES.includes(n)) && <button className="btn" disabled={comment.trim().length < 5} onClick={() => decide('Approved with conditions')}>Approve with conditions</button>}
        <button className="btn danger" disabled={comment.trim().length < 5} onClick={() => decide('Returned')}><CornerDownLeft size={15} /> Return</button>
      </div>
    </section>
  );
}

function SignOffs({ s, n, rec }) {
  const need = requiredApprovals(n, s.assessment.results.tier);
  if (!need.length) return null;
  return (
    <Panel title="Sign-offs">
      {need.map((r) => {
        const a = rec.approvals?.[r];
        return (
          <div key={r} className="signoff">
            <span className={`so-dot ${a ? (a.outcome === 'Returned' ? 'warn' : 'good') : ''}`}>{a ? (a.outcome === 'Returned' ? <CornerDownLeft size={12} /> : <Check size={12} strokeWidth={3} />) : null}</span>
            <span className="small" style={{ flex: 1 }}>{ROLES[r].name}</span>
            {a ? <Pill tone={a.outcome === 'Returned' ? 'warn' : 'good'}>{a.outcome}</Pill> : <span className="xs mute">{rec.status === 'submitted' ? 'Waiting' : 'Not yet'}</span>}
          </div>
        );
      })}
    </Panel>
  );
}

// Who did what on this stage. Internal notes only for the governance team.
function Activity({ rec }) {
  const { role } = useStore();
  const team = CAN.internal(role);
  const items = [...(rec.log || [])].reverse();
  if (!items.length) return null;
  return (
    <Panel title="Activity">
      <ol className="activity">
        {items.map((e, i) => (
          <li key={i}>
            <span className={`act-dot tone-${OUTCOME_TONE[e.outcome] || 'mute'}`} />
            <div style={{ minWidth: 0 }}>
              <div className="small"><b style={{ fontWeight: 600 }}>{e.outcome}</b> <span className="mute">by {WHO[e.who] || e.who}</span></div>
              <div className="xs mute num">{fmtDate(e.at)}</div>
              {e.comment && <div className="small act-text">{e.comment}</div>}
              {team && e.internal && <div className="small act-internal"><Lock size={11} /> {e.internal}</div>}
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function ChecklistView({ st, rec, editable, onToggle, onAll }) {
  const done = st.checklist.filter((i) => rec.checklist[i]).length;
  return (
    <Panel title="Checklist" right={<span className="count-chip num">{done}/{st.checklist.length}</span>}>
      {st.checklist.map((item) => (editable ? (
        <label key={item} className="check-row">
          <input type="checkbox" checked={!!rec.checklist[item]} onChange={() => onToggle(item)} />
          <span>{item}</span>
        </label>
      ) : (
        <div key={item} className={`check-ro ${rec.checklist[item] ? 'on' : ''}`}>
          {rec.checklist[item] ? <CheckCircle2 size={17} /> : <Circle size={17} />}<span>{item}</span>
        </div>
      )))}
      {editable && done < st.checklist.length && <button type="button" className="btn ghost sm" style={{ marginTop: 6, paddingLeft: 0 }} onClick={onAll}>Tick all</button>}
    </Panel>
  );
}

function StageView({ s, n }) {
  const { role, toggleCheck, checkAll, setEvidence, submitStage, override, startEvent } = useStore();
  const [howOpen, setHowOpen] = useState(false);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [event, setEvent] = useState({ kind: '', text: '' });
  const st = stageOf(n);
  const rec = s.stages?.[n] || newStage();
  const isCurrent = n === s.stage && !['Retired', 'Blocked'].includes(s.status);
  const working = isCurrent && ['open', 'returned'].includes(rec.status);
  const canEdit = working && CAN.work(role);
  const blockers = stageBlockers(s);
  const total = st.checklist.length + st.evidence.length;
  const doneN = st.checklist.filter((i) => rec.checklist[i]).length + st.evidence.filter((i) => rec.evidence[i]).length;
  const evCount = st.evidence.filter((i) => rec.evidence[i]).length;
  const status = isCurrent || rec.status === 'approved' ? STAGE_STATUS[rec.status] : ON_DEMAND.includes(n) ? 'Only if needed' : 'Not started';
  const ph = phaseOf(n);
  return (
    <div className="stage-layout fade-in" key={n}>
      <div className="stack">
        <section className="panel stage-head">
          <div className="stage-num">{n}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="eyebrow">{ph.name} phase{GATE_STAGES.includes(n) ? ' · approval gate' : ''}</div>
            <h2>{st.name}</h2>
            <p className="mute small" style={{ marginTop: 4, maxWidth: '72ch' }}>{st.objective}</p>
            <button type="button" className="btn ghost sm" style={{ marginTop: 6, paddingLeft: 0 }} aria-expanded={howOpen} onClick={() => setHowOpen(!howOpen)}>
              <ChevronDown size={14} className={`chev ${howOpen ? 'open' : ''}`} /> How to complete this stage
            </button>
            {howOpen && <ol className="list-plain small fade-in" style={{ marginTop: 4 }}>{st.process.map((x) => <li key={x}>{x}</li>)}</ol>}
          </div>
          <StatusPill status={status} />
        </section>

        {rec.status === 'returned' && rec.returnNote && <div className="callout warn"><b>Returned by the governance team:</b> {rec.returnNote}</div>}
        {rec.conditions && <div className="callout"><b>Conditions:</b> {rec.conditions}</div>}
        {isCurrent && rec.status === 'submitted' && role === 'client' && <div className="callout"><b>With the governance team.</b> Submitted {fmtDate(rec.submittedAt)}. You'll see their decision here.</div>}
        {working && !CAN.work(role) && <div className="callout small"><b>The client is working on this stage.</b> You can review it once they submit.</div>}

        <ChecklistView st={st} rec={rec} editable={canEdit} onToggle={(item) => toggleCheck(s.id, n, item)} onAll={() => checkAll(s.id, n, st.checklist)} />
        <Panel title="Evidence" right={<span className="count-chip num">{evCount}/{st.evidence.length}</span>}>
          {st.evidence.map((item) => (
            <EvidenceItem key={`${n}-${item}`} item={item} value={rec.evidence[item]} editable={canEdit} systemId={s.id} stage={n} onSave={(v) => setEvidence(s.id, n, item, v)} />
          ))}
        </Panel>
      </div>

      <aside className="stack stage-side">
        <section className="panel progress-card">
          <div className="row" style={{ gap: 14, flexWrap: 'nowrap' }}>
            <Ring done={doneN} total={total} size={58} />
            <div>
              <div className="small"><b>{doneN} of {total}</b> items done</div>
              <div className="xs mute">{st.checklist.length} checks · {st.evidence.length} evidence items</div>
            </div>
          </div>
          {canEdit && (
            <div className="submit-box">
              <Field label="Note for the reviewer"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <button className="btn primary block" disabled={blockers.length > 0} onClick={() => { submitStage(s.id, n, note.trim()); setNote(''); }}>
                <Send size={15} /> {n === 7 ? 'Submit periodic review' : 'Submit for review'}
              </button>
              {blockers.length > 0 && <p className="xs mute">{blockers.join('. ')}.</p>}
            </div>
          )}
        </section>

        {isCurrent && rec.status === 'submitted' && <ReviewBox s={s} n={n} rec={rec} />}
        {(isCurrent || rec.status === 'approved') && <SignOffs s={s} n={n} rec={rec} />}
        <div className="gate"><ShieldCheck size={18} /><div><b>Exit gate</b><div className="small">{st.exit}</div></div></div>
        <Activity rec={rec} />

        {isCurrent && CAN.override(role) && rec.status !== 'approved' && (
          <Panel title="Override gate" sub="Moves the product on without the remaining sign-offs. The reason is recorded.">
            <textarea className="input" rows={2} aria-label="Override reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (at least 15 characters)" />
            <button className="btn danger" style={{ marginTop: 8 }} disabled={reason.trim().length < 15} onClick={() => { override(s.id, n, reason.trim()); setReason(''); }}>Override</button>
          </Panel>
        )}

        {isCurrent && n === 7 && CAN.raiseEvent(role) && (
          <Panel title="Something changed?">
            <div className="stack">
              <Field label="Type">
                <select className="input" value={event.kind} onChange={(e) => setEvent({ ...event, kind: e.target.value })}>
                  <option value="">Choose…</option><option value="change">Material change</option><option value="incident">AI incident</option><option value="retire">Retire the product</option>
                </select>
              </Field>
              <Field label="What happened"><input className="input" value={event.text} onChange={(e) => setEvent({ ...event, text: e.target.value })} /></Field>
              <button className="btn" disabled={!event.kind || event.text.trim().length < 5} onClick={() => { startEvent(s.id, event.kind, event.text.trim()); setEvent({ kind: '', text: '' }); }}>
                {{ change: 'Start change review', incident: 'Report incident', retire: 'Start retirement', '': 'Start' }[event.kind]}
              </button>
            </div>
          </Panel>
        )}
      </aside>
    </div>
  );
}

function Lifecycle({ s }) {
  const [view, setView] = useState(s.stage);
  return (
    <div className="stack">
      <section className="panel"><LifecycleRail s={s} viewing={view} onPick={setView} /></section>
      {s.status === 'Blocked' && <div className="callout bad">Prohibited practice. This product cannot move through the lifecycle.</div>}
      {view !== s.stage && <div className="callout small row">Viewing stage {view}. <button className="btn ghost sm" onClick={() => setView(s.stage)}>Back to the current stage</button></div>}
      <StageView key={`${view}-${s.stage}`} s={s} n={view} />
    </div>
  );
}

function Assessment({ s, nav }) {
  const { role } = useStore();
  const a = s.assessment; const fws = a.frameworks; const p = a.profile;
  return (
    <div className="stack">
      <Panel title="Product details" right={CAN.work(role) && s.status !== 'Retired' && <button className="btn sm" onClick={() => nav(`/reassess/${s.id}`)}><RefreshCw size={14} /> Re-assess</button>}>
        <dl className="kv">
          <dt>Description</dt><dd>{s.description}</dd>
          <dt>Domain</dt><dd>{label(DOMAINS, p.domain)}</dd>
          <dt>Type of AI</dt><dd>{label(SYSTEM_TYPES, p.systemType)}</dd>
          <dt>Sourcing</dt><dd>{label(SOURCING, p.sourcing)}</dd>
          <dt>Countries</dt><dd>{p.geos.map(geoName).join(', ')}</dd>
          <dt>Frameworks</dt><dd>{fws.map(fwName).join(', ')}</dd>
          <dt>Assessed</dt><dd>{fmtDate(a.at)}</dd>
        </dl>
      </Panel>
      {sectionOrder(fws).map((k) => {
        const qs = a.questions.filter((q) => sectionOf(q, fws) === k);
        if (!qs.length) return null;
        return (
          <Panel key={k} title={fwName(k)}>
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {qs.map((q) => {
                    const v = a.answers[q.id];
                    return (
                      <tr key={q.id}>
                        <td style={{ maxWidth: 460 }}>{q.q}<div className="xs mute">{PRINCIPLES[q.principle]?.short}{q.kind !== 'core' ? ', tailored' : ''}</div></td>
                        <td className="small" style={{ maxWidth: 300 }}>{v === 'na' ? 'Not applicable' : q.options[v]}</td>
                        <td>{v === 'na' ? <Pill>N/A</Pill> : <Pill tone={['bad', 'warn', 'ok', 'good'][v]}>{LEVEL_NAMES[v]}</Pill>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

function Actions({ s }) {
  const { updateAction, role } = useStore();
  const today = new Date().toISOString().slice(0, 10);
  if (!s.actions.length) return <Panel><div className="empty">No gaps found.</div></Panel>;
  return (
    <Panel>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Priority</th><th>Action</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {s.actions.map((a) => (
              <tr key={a.id}>
                <td><Pill tone={{ High: 'bad', Medium: 'warn', Low: 'ok' }[a.priority]}>{a.priority}</Pill></td>
                <td style={{ maxWidth: 420 }}><b style={{ fontWeight: 500 }}>{a.topic}</b><div className="small mute">{a.action}</div></td>
                <td><input className="input" aria-label={`Owner of ${a.topic}`} disabled={!CAN.work(role)} style={{ width: 150, padding: '5px 8px' }} value={a.owner} onChange={(e) => updateAction(s.id, a.id, { owner: e.target.value })} placeholder="Unassigned" /></td>
                <td className={`num small ${a.status !== 'Done' && a.due < today ? 'tone-bad' : ''}`}>{a.due}</td>
                <td>
                  <select className="input" aria-label={`Status of ${a.topic}`} disabled={!CAN.work(role)} style={{ width: 130, padding: '5px 8px' }} value={a.status} onChange={(e) => updateAction(s.id, a.id, { status: e.target.value })}>
                    {['Open', 'In progress', 'Done'].map((x) => <option key={x}>{x}</option>)}
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

function DataTab({ s }) {
  const { saveData, role } = useStore();
  const [edit, setEdit] = useState(false);
  const [d, setD] = useState(s.datasets); const [o, setO] = useState(s.outputs);
  const cov = catalogCoverage(s.datasets);
  return (
    <div className="stack">
      <Panel title="Lineage" right={!edit && CAN.work(role) && <button className="btn sm" onClick={() => { setD(s.datasets); setO(s.outputs); setEdit(true); }}>Edit data assets</button>}>
        <LineageGraph name={s.name} datasets={edit ? d : s.datasets} outputs={edit ? o : s.outputs} />
      </Panel>
      {edit ? (
        <Panel title="Edit data assets" right={<div className="row"><button className="btn" onClick={() => setEdit(false)}>Cancel</button><button className="btn primary" onClick={() => { saveData(s.id, d.filter((x) => x.name.trim()), o); setEdit(false); }}>Save data assets</button></div>}>
          <DataAssets datasets={d} outputs={o} onChange={(a, b) => { setD(a); setO(b); }} />
        </Panel>
      ) : (
        <Panel title="Datasets" sub={`${cov.catalogued}% in the catalog, ${cov.lineage}% with lineage, ${cov.stewarded}% with a steward`}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Dataset</th><th>Source</th><th>Class</th><th>Owner</th><th>Steward</th><th>Catalog</th><th>Lineage</th><th>Quality</th></tr></thead>
              <tbody>
                {s.datasets.map((x) => (
                  <tr key={x.id}>
                    <td><b style={{ fontWeight: 500 }}>{x.name}</b><div className="xs mute">{x.role}</div></td>
                    <td className="small">{x.sourceSystem}</td>
                    <td><span className="tag">{x.classification}</span></td>
                    <td className="small">{x.owner || '—'}</td><td className="small">{x.steward || <span className="tone-bad">None</span>}</td>
                    {['catalogued', 'lineage', 'qualityChecked'].map((k) => <td key={k}><Pill tone={x[k] ? 'good' : 'bad'}>{x[k] ? 'Yes' : 'No'}</Pill></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!s.datasets.length && <div className="empty">No datasets yet.</div>}
        </Panel>
      )}
    </div>
  );
}

function History({ s }) {
  const data = s.history.map((h, i) => ({ n: `${i + 1}. ${h.at.slice(0, 10)}`, Score: h.residual, 'Controls in place': h.readiness }));
  const approvals = STAGES.flatMap((st) => (s.stages?.[st.n]?.approvedAt ? [{ at: s.stages[st.n].approvedAt, text: `Stage ${st.n} approved: ${st.name}${s.stages[st.n].conditions ? ` (${s.stages[st.n].conditions})` : ''}` }] : []));
  const events = [...approvals, ...(s.events || []).map((e) => ({ at: e.at, text: `${{ change: 'Change', incident: 'Incident', retire: 'Retirement' }[e.kind]}: ${e.text}` }))].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="grid g2">
      <Panel title="Score over time">
        <div style={{ height: 220 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ right: 20 }}>
              <CartesianGrid stroke="#EBEEF2" vertical={false} />
              <XAxis dataKey="n" tick={{ fontSize: 12 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 12 }} /><Tooltip />
              <Line dataKey="Score" stroke="#B83A2E" isAnimationActive={false} />
              <Line dataKey="Controls in place" stroke="#3A46C9" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <Panel title="Timeline">
        {events.length === 0 ? <p className="small mute">Nothing yet.</p> : events.map((e, i) => (
          <div key={i} className="small" style={{ padding: '7px 0', borderTop: i ? '1px solid var(--line-2)' : 0 }}><span className="mute num">{fmtDate(e.at)}</span> {e.text}</div>
        ))}
      </Panel>
    </div>
  );
}

export default function Product({ id, nav, back }) {
  const { getSystem, state, role } = useStore();
  const [tab, setTab] = useState('lifecycle');
  const s = getSystem(id);
  if (!s) return <div className="panel empty">This product was not found. <button className="btn ghost" onClick={() => nav(back)}>Back</button></div>;
  if (s.status === 'Draft') return <div className="panel empty">This product is still a draft. {CAN.work(role) && <button className="btn primary" onClick={() => nav(`/draft/${s.id}`)}>Continue registration</button>}</div>;
  const r = s.assessment.results;
  const client = state.clients.find((c) => c.id === s.clientId);
  const open = s.actions.filter((x) => x.status !== 'Done').length;
  const rec = s.stages?.[s.stage];
  const mine = waitingOn(s).includes(role) || (role === 'lead' && waitingOn(s).includes('assessor'));
  const yourTurn = (CAN.work(role) && ['open', 'returned'].includes(rec?.status) && !['Retired', 'Blocked'].includes(s.status)) || (CAN.review(role) && mine);
  return (
    <div className="fade-in">
      <button className="btn ghost back" onClick={() => nav(back)}><ArrowLeft size={16} /> Back</button>
      <section className="product-hero">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">{role !== 'client' && client ? `${client.name} · ` : ''}{s.code}</div>
          <div className="row" style={{ marginTop: 2 }}><h1>{s.name}</h1><TierBadge tier={r.tier} /></div>
          <p className="mute small" style={{ marginTop: 4 }}>{s.owner ? `Owner ${s.owner}` : ''}{s.bu ? ` · ${s.bu}` : ''}</p>
        </div>
        <div className="hero-stage">
          <div className="xs mute">Current stage</div>
          <div className="hero-stage-name"><span className="stage-chip">{s.stage}</span> {stageOf(s.stage).name}</div>
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <StatusPill status={s.status === 'Blocked' || s.status === 'Retired' ? s.status : STAGE_STATUS[rec?.status || 'open']} />
            {yourTurn && <span className="your-turn">{CAN.work(role) ? 'Your turn' : 'Needs your review'}</span>}
          </div>
        </div>
        <button className="btn" onClick={() => downloadReport(s, state.audit.filter((x) => x.target === s.id), client)}><Download size={15} /> Report</button>
      </section>
      <Tabs value={tab} onChange={setTab} tabs={[['lifecycle', 'Lifecycle'], ['overview', 'Risk and score'], ['assessment', 'Assessment'], ['data', 'Data and lineage'], ['actions', `Actions (${open})`], ['history', 'History']]} />
      <div key={tab} className="fade-in">
        {tab === 'overview' && <Results results={r} frameworks={s.assessment.frameworks} />}
        {tab === 'lifecycle' && <Lifecycle s={s} />}
        {tab === 'assessment' && <Assessment s={s} nav={nav} />}
        {tab === 'data' && <DataTab s={s} />}
        {tab === 'actions' && <Actions s={s} />}
        {tab === 'history' && <History s={s} />}
      </div>
    </div>
  );
}

export { TIERS };
