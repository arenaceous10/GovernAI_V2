import { useState } from 'react';
import { ArrowLeft, BookMarked, Check, CheckCircle2, ChevronDown, Circle, SkipForward, Plus, Presentation, FileText, CornerDownLeft, Download, ExternalLink, Gavel, Link2, Loader2, Lock, Paperclip, RefreshCw, Send, ShieldCheck, X } from 'lucide-react';
import { uploadEvidence, evidenceUrl, removeEvidence, hasFile, isLink, fmtSize } from '../lib/files.js';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TIERS, DOMAINS, SOURCING, PRINCIPLES, selectionLabel, systemTypeLabel } from '../data/frameworks.js';
import { geoName } from '../data/countries.js';
import { STAGES, stageOf, requiredApprovals, ROLES, STAGE_STATUS, GATE_STAGES, ON_DEMAND, phaseOf } from '../data/lifecycle.js';
import { LEVEL_NAMES } from '../data/questionBank.js';
import { sectionOf, sectionOrder } from '../engine/engine.js';
import { controlFor, itemState, isMandatory, validReason, controlStatus, SKIP_REASONS, MIN_REASON, COMPASS, COMPASS_IDS } from '../data/controls.js';
import { downloadReport } from '../engine/report.js';
import { downloadDeck } from '../engine/deck.js';
import { annexIV, dpdpPack, downloadPack } from '../engine/docpack.js';
import { Panel, Pill, Tabs, TierBadge, fmtDate, StatusPill, Field } from '../components/ui.jsx';
import { LifecycleRail, Ring } from '../components/Stages.jsx';
import { toast, ProductDeadlines } from '../components/Extras.jsx';
import Results, { fwName } from '../components/Results.jsx';
import DataAssets, { catalogCoverage } from '../components/DataAssets.jsx';
import LineageGraph from '../components/LineageGraph.jsx';
import { useStore, stageBlockers, waitingOn, newStage, CAN } from '../store/store.jsx';
import { RecordTab } from '../components/Proof.jsx';

const label = (list, id) => list.find((x) => x.id === id)?.label || id || '—';

// Opens a stored file in a new tab. The tab is opened before the signed link is fetched so pop-up blockers allow it.
async function openFile(v, setErr) {
  setErr('');
  const w = window.open('', '_blank');
  if (w) w.opener = null;
  try {
    let url = await evidenceUrl(v);
    if (url?.startsWith('data:')) {   // demo mode only (evidenceUrl allows safe types); decode without fetch, which the CSP blocks
      const [head, body] = url.split(',', 2);
      const type = head.slice(5).split(';')[0];
      const bytes = head.includes(';base64') ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(body));
      url = URL.createObjectURL(new Blob([bytes], { type }));
    }
    const proto = new URL(url, window.location.href).protocol;
    if (!['https:', 'blob:'].includes(proto) && !(proto === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(new URL(url).hostname))) throw new Error('This link cannot be opened.');
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
      setOpen(false); toast(`${f.name} uploaded`);
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
  const skips = st.checklist.filter((i) => rec.skipped?.[i]);
  const decide = (outcome) => { reviewStage(s.id, n, mySlot, outcome, comment.trim(), internal.trim()); setComment(''); setInternal(''); toast(outcome === 'Returned' ? `Stage ${n} returned to the client` : `Stage ${n} ${outcome.toLowerCase()}`, outcome === 'Returned' ? 'warn' : 'good'); };
  return (
    <section className="panel decision">
      <div className="decision-head"><Gavel size={16} /> <h2>Your decision</h2></div>
      <p className="small mute">{done} of {st.checklist.length + st.evidence.length} items completed by the client.{rec.note ? ` Note: "${rec.note}"` : ''}</p>
      {skips.length > 0 && <div className="callout warn small"><b>{skips.length} check{skips.length > 1 ? 's' : ''} skipped.</b> Read the reasons in the checklist before you decide. Return the stage if a reason is not good enough.</div>}
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
  const { role, state } = useStore();
  const noteText = (e) => (e.noteId ? state.notes?.find((x) => x.id === e.noteId)?.text : e.internal);
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
              {team && noteText(e) && <div className="small act-internal"><Lock size={11} /> {noteText(e)}</div>}
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

// One checklist row: tick it, or (if optional) skip it with a reason. Each item names the control it evidences.
function CheckItem({ item, rec, editable, mandatory, onToggle, onSkip, onUnskip }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState(''); const [reason, setReason] = useState(''); const [due, setDue] = useState(''); const [err, setErr] = useState('');
  const c = controlFor(item); const st = itemState(rec, item); const sk = rec.skipped?.[item];
  const why = SKIP_REASONS.find((r) => r.id === (sk?.category || cat));
  const hint = reason ? validReason(reason) : '';
  const save = () => { const e = onSkip({ category: cat, reason, due }); if (e) setErr(e); else { setOpen(false); setReason(''); setCat(''); setDue(''); setErr(''); toast('Check skipped with a reason'); } };
  return (
    <div className={`check-item ${st}`}>
      <div className="check-line">
        {editable && st !== 'skipped'
          ? <input type="checkbox" aria-label={item} checked={st === 'done'} onChange={onToggle} />
          : st === 'done' ? <CheckCircle2 size={17} className="ci-ico done" /> : st === 'skipped' ? <SkipForward size={16} className="ci-ico skip" /> : <Circle size={17} className="ci-ico" />}
        <span className="ci-text">{item}</span>
        <span className="ci-tags">
          <span className={`ci-tag ${mandatory ? 'must' : ''}`}>{mandatory ? 'Mandatory' : 'Optional'}</span>
          <span className="ci-tag ctl" title={`${c.name} · ${c.family} · ${c.type}`}>{c.id}</span>
        </span>
        {editable && !mandatory && st === 'open' && !open && <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>Skip</button>}
        {editable && st === 'skipped' && <button type="button" className="btn ghost sm" onClick={onUnskip}>Undo skip</button>}
      </div>
      {st === 'skipped' && sk && (
        <div className="ci-skip"><b>Skipped: {why?.label}.</b> {sk.reason}{sk.due ? ` Target date ${sk.due}.` : ''}{why?.action ? ' An action was added.' : ''}</div>
      )}
      {open && (
        <div className="ci-form fade-in">
          <div className="grid g2">
            <Field label="Why skip it?">
              <select className="input" value={cat} onChange={(e) => { setCat(e.target.value); setErr(''); }}>
                <option value="">Choose…</option>{SKIP_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </Field>
            {why?.needsDate && <Field label="Done by"><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>}
          </div>
          <Field label="Explain for the reviewer" hint={hint || `At least ${MIN_REASON} characters. The governance team sees this.`}>
            <textarea className="input" rows={2} value={reason} onChange={(e) => { setReason(e.target.value); setErr(''); }} aria-label={`Reason for skipping ${item}`} />
          </Field>
          {err && <div className="xs" role="alert" style={{ color: 'var(--bad)' }}>{err}</div>}
          <div className="row"><button type="button" className="btn primary sm" disabled={!cat || !!validReason(reason)} onClick={save}>Skip with this reason</button><button type="button" className="btn ghost sm" onClick={() => { setOpen(false); setErr(''); }}>Cancel</button></div>
        </div>
      )}
    </div>
  );
}

function ChecklistView({ st, rec, editable, tier, rules, onToggle, onAll, onSkip, onUnskip }) {
  const done = st.checklist.filter((i) => rec.checklist[i]).length;
  const skipped = st.checklist.filter((i) => itemState(rec, i) === 'skipped').length;
  const mand = st.checklist.filter((i) => isMandatory(i, tier, rules)).length;
  return (
    <Panel title="Checklist" sub={`${mand} mandatory, ${st.checklist.length - mand} optional. Optional checks can be skipped with a reason.`}
      right={<span className="count-chip num">{done}/{st.checklist.length}{skipped ? ` · ${skipped} skipped` : ''}</span>}>
      {st.checklist.map((item) => (
        <CheckItem key={item} item={item} rec={rec} editable={editable} mandatory={isMandatory(item, tier, rules)}
          onToggle={() => onToggle(item)} onSkip={(v) => onSkip(item, v)} onUnskip={() => onUnskip(item)} />
      ))}
      {editable && done + skipped < st.checklist.length && <button type="button" className="btn ghost sm" style={{ marginTop: 6, paddingLeft: 0 }} onClick={onAll}>Tick all</button>}
    </Panel>
  );
}

function StageView({ s, n }) {
  const { role, toggleCheck, checkAll, skipCheck, unskipCheck, setEvidence, submitStage, override, startEvent, state } = useStore();
  const rules = state.settings.checklistRules || {};
  const tier = s.assessment.results.tier;
  const [howOpen, setHowOpen] = useState(false);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [event, setEvent] = useState({ kind: '', text: '' });
  const st = stageOf(n);
  const rec = s.stages?.[n] || newStage();
  const isCurrent = n === s.stage && !['Retired', 'Blocked'].includes(s.status);
  const working = isCurrent && ['open', 'returned'].includes(rec.status);
  const canEdit = working && CAN.work(role);
  const blockers = stageBlockers(s, rules);
  const total = st.checklist.length + st.evidence.length;
  const skippedN = st.checklist.filter((i) => itemState(rec, i) === 'skipped').length;
  const doneN = st.checklist.filter((i) => rec.checklist[i]).length + skippedN + st.evidence.filter((i) => rec.evidence[i]).length;
  const evCount = st.evidence.filter((i) => rec.evidence[i]).length;
  const status = isCurrent || rec.status === 'approved' ? STAGE_STATUS[rec.status] : ON_DEMAND.includes(n) ? 'Only if needed' : 'Not started';
  const ph = phaseOf(n);
  return (
    <div className="stage-layout fade-in" key={n}>
      <div className="stack">
        <section className="panel stage-head">
          <div className="stage-num">{n}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2>{st.name}</h2>
            <p className="stage-meta">{ph.name} phase{GATE_STAGES.includes(n) ? ', approval gate' : ''}</p>
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

        <ChecklistView st={st} rec={rec} editable={canEdit} tier={tier} rules={rules} onToggle={(item) => toggleCheck(s.id, n, item)} onAll={() => checkAll(s.id, n, st.checklist)}
          onSkip={(item, v) => skipCheck(s.id, n, item, v)} onUnskip={(item) => unskipCheck(s.id, n, item)} />
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
              <div className="xs mute">{st.checklist.length} checks{skippedN ? ` (${skippedN} skipped)` : ''} · {st.evidence.length} evidence items</div>
            </div>
          </div>
          {canEdit && (
            <div className="submit-box">
              <Field label="Note for the reviewer"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <button className="btn primary block" disabled={blockers.length > 0} onClick={() => { submitStage(s.id, n, note.trim()); setNote(''); toast(`Stage ${n} sent to the governance team`); }}>
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
            <button className="btn danger" style={{ marginTop: 8 }} disabled={reason.trim().length < 15} onClick={() => { override(s.id, n, reason.trim()); setReason(''); toast(`Stage ${n} moved on by override`, 'warn'); }}>Override</button>
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
              <button className="btn" disabled={!event.kind || event.text.trim().length < 5} onClick={() => { startEvent(s.id, event.kind, event.text.trim()); toast({ change: 'Change review started', incident: 'Incident reported', retire: 'Retirement started' }[event.kind]); setEvent({ kind: '', text: '' }); }}>
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
          <dt>Domain</dt><dd>{selectionLabel(DOMAINS, p.domain, p.domainOther)}</dd>
          <dt>Type of AI</dt><dd>{systemTypeLabel(p.systemType, p.systemTypeOther)}</dd>
          <dt>Sourcing</dt><dd>{selectionLabel(SOURCING, p.sourcing, p.sourcingOther)}</dd>
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
                        <td className="small" style={{ maxWidth: 300 }}>{v === 'na' ? 'Not applicable' : v === 'unknown' ? 'Not known: scored as not in place until confirmed' : q.options[v]}</td>
                        <td>{v === 'na' ? <Pill>N/A</Pill> : v === 'unknown' ? <Pill tone="warn">Not known</Pill> : <Pill tone={['bad', 'warn', 'ok', 'good'][v]}>{LEVEL_NAMES[v]}</Pill>}</td>
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

const CTL_TONE = { Operating: 'good', 'In progress': 'ok', Partial: 'warn', Gap: 'bad', Designed: 'ok' };
const SRC = { checklist: 'From a skipped check', unknown: 'From a "Not known" answer', reviewer: 'Required by the governance team', manual: 'Added by the client', assessment: 'From the assessment' };

// Controls: library controls evidenced by the lifecycle checklist, plus any controls added for this product.
function ControlsPanel({ s }) {
  const { state, role, addAction, addControl } = useStore();
  const rows = controlStatus(s, state.settings.checklistRules || {});
  const can = CAN.work(role) || CAN.review(role);
  const [raise, setRaise] = useState(null); const [form, setForm] = useState({ action: '', priority: 'Medium', due: '', owner: '' });
  const [adding, setAdding] = useState(false); const [k, setK] = useState({ name: '', family: 'Custom', type: 'Preventive', compass: 'accountability', owner: '', frequency: 'Per release', description: '' });
  const [err, setErr] = useState('');
  const submitAction = () => { const e = addAction(s.id, { ...form, control: raise.id, topic: raise.name }); if (e) setErr(e); else { setRaise(null); setForm({ action: '', priority: 'Medium', due: '', owner: '' }); setErr(''); toast('Action added'); } };
  const submitControl = () => { const e = addControl(s.id, k); if (e) setErr(e); else { setAdding(false); setK({ ...k, name: '', description: '', owner: '' }); setErr(''); toast('Control added'); } };
  const gaps = rows.filter((r) => r.status === 'Gap' || r.status === 'Partial').length;
  return (
    <Panel title="Controls" sub={`${rows.filter((r) => r.status === 'Operating').length} operating, ${gaps} with a gap, ${rows.length} evidenced so far by the lifecycle checklist`}
      right={can && !adding && <button className="btn sm" onClick={() => { setAdding(true); setErr(''); }}><Plus size={14} /> Add a control</button>}>
      {adding && (
        <div className="ci-form" style={{ margin: '0 0 12px' }}>
          <div className="grid g3">
            <Field label="Control name"><input className="input" value={k.name} onChange={(e) => setK({ ...k, name: e.target.value })} placeholder="e.g. Quarterly bias review by the claims team" /></Field>
            <Field label="Type"><select className="input" value={k.type} onChange={(e) => setK({ ...k, type: e.target.value })}>{['Preventive', 'Detective', 'Corrective'].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Compass direction"><select className="input" value={k.compass} onChange={(e) => setK({ ...k, compass: e.target.value })}>{COMPASS_IDS.map((x) => <option key={x} value={x}>{COMPASS[x].name}</option>)}</select></Field>
            <Field label="Control owner"><input className="input" value={k.owner} onChange={(e) => setK({ ...k, owner: e.target.value })} placeholder="Role or name" /></Field>
            <Field label="How often"><select className="input" value={k.frequency} onChange={(e) => setK({ ...k, frequency: e.target.value })}>{['Per release', 'Continuous', 'Monthly', 'Quarterly', 'Yearly'].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="What it does"><input className="input" value={k.description} onChange={(e) => setK({ ...k, description: e.target.value })} /></Field>
          </div>
          {err && <div className="xs" role="alert" style={{ color: 'var(--bad)' }}>{err}</div>}
          <div className="row"><button className="btn primary sm" disabled={k.name.trim().length < 4} onClick={submitControl}>Add control</button><button className="btn ghost sm" onClick={() => setAdding(false)}>Cancel</button></div>
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Control</th><th>Compass</th><th>Checks</th><th>Status</th><th /></tr></thead>
          <tbody>
            {[...rows.map((r) => ({ id: r.control.id, name: r.control.name, family: r.control.family, type: r.control.type, compass: r.control.compass, r })), ...(s.customControls || []).map((c) => ({ ...c, custom: true }))].map((c) => (
              <tr key={c.id}>
                <td style={{ maxWidth: 380 }}><b style={{ fontWeight: 500 }}><span className="ci-tag ctl">{c.id}</span> {c.name}</b>
                  <div className="xs mute">{c.family} · {c.type}{c.custom ? ` · ${c.frequency}${c.owner ? ` · owner ${c.owner}` : ''}` : ''}{c.r?.mandatory ? ' · mandatory' : ''}</div>
                  {c.r && c.r.items.filter((i) => i.state === 'skipped').map((i) => <div key={i.item} className="xs ci-skip" style={{ margin: '4px 0 0' }}>Stage {i.stage}: {i.item} Skipped: {i.skip?.reason}</div>)}
                </td>
                <td className="small">{COMPASS[c.compass]?.name}</td>
                <td className="small num">{c.r ? `${c.r.done} done${c.r.skipped ? `, ${c.r.skipped} skipped` : ''}${c.r.open ? `, ${c.r.open} open` : ''}` : 'Product control'}</td>
                <td><Pill tone={CTL_TONE[c.r ? c.r.status : c.status]}>{c.r ? c.r.status : c.status}</Pill></td>
                <td>{can && <button className="btn ghost sm" onClick={() => { setRaise(c); setErr(''); }}>Raise action</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {raise && (
        <div className="ci-form" style={{ margin: '12px 0 0' }}>
          <b className="small">New action on {raise.id} {raise.name}</b>
          <div className="grid g3">
            <Field label="Action"><input className="input" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} placeholder="What has to be done" /></Field>
            <Field label="Priority"><select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{['High', 'Medium', 'Low'].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Due"><input className="input" type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></Field>
          </div>
          {err && <div className="xs" role="alert" style={{ color: 'var(--bad)' }}>{err}</div>}
          <div className="row"><button className="btn primary sm" onClick={submitAction}>Add action</button><button className="btn ghost sm" onClick={() => setRaise(null)}>Cancel</button></div>
        </div>
      )}
    </Panel>
  );
}

function Actions({ s }) {
  const { updateAction, role } = useStore();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="stack">
      <Panel title="Actions" sub="Gaps from the assessment, skipped checks, Not known answers and actions raised on controls">
        {!s.actions.length ? <div className="empty">No gaps found.</div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Priority</th><th>Action</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
              <tbody>
                {s.actions.map((a) => (
                  <tr key={a.id}>
                    <td><Pill tone={{ High: 'bad', Medium: 'warn', Low: 'ok' }[a.priority]}>{a.priority}</Pill></td>
                    <td style={{ maxWidth: 420 }}><b style={{ fontWeight: 500 }}>{a.topic}</b><div className="small mute">{a.action}</div>
                      <div className="xs mute">{SRC[a.source] || SRC.assessment}{a.control ? ` · control ${a.control}` : ''}</div></td>
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
        )}
      </Panel>
      <ControlsPanel s={s} />
    </div>
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
              <CartesianGrid stroke="#E3E8EF" />
              <XAxis dataKey="n" tick={{ fontSize: 12, fill: '#4A5568' }} axisLine={{ stroke: '#D5DCE5' }} tickLine={{ stroke: '#D5DCE5' }} /><YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#4A5568' }} axisLine={{ stroke: '#D5DCE5' }} tickLine={{ stroke: '#D5DCE5' }} /><Tooltip />
              <Line dataKey="Score" stroke="#B83A2E" isAnimationActive={false} />
              <Line dataKey="Controls in place" stroke="var(--accent)" isAnimationActive={false} />
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

// Two outputs: a dashboard deck (PowerPoint with native, editable charts) and the full audit report (HTML).
function ReportMenu({ s, audit, client }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const deck = async () => {
    setBusy(true);
    try { await downloadDeck(s, { audit, client, rules: state.settings.checklistRules || {} }); toast('Dashboard deck downloaded'); }
    catch (e) { toast(`Could not build the deck: ${e.message}`, 'warn'); }
    finally { setBusy(false); setOpen(false); }
  };
  const [sdf, setSdf] = useState(false);
  const doc = async (kind) => {
    setBusy(true);
    try {
      const d = kind === 'annex' ? annexIV(s, { client }) : dpdpPack(s, { client, significant: sdf });
      await downloadPack(d, `${kind === 'annex' ? 'annex-iv' : 'dpdp'}-${(s.code || s.id).replace(/[^A-Za-z0-9-]/g, '')}.docx`);
      toast(`${kind === 'annex' ? 'Annex IV draft' : 'DPDP pack'} downloaded: ${d.coverage.filled} of ${d.coverage.total} items filled`);
    } catch (e) { toast(`Could not build the document: ${e.message}`, 'warn'); }
    finally { setBusy(false); setOpen(false); }
  };
  return (
    <div className="menu-wrap">
      <button className="btn" aria-expanded={open} onClick={() => setOpen(!open)}><Download size={15} /> Report <ChevronDown size={14} /></button>
      {open && (
        <div className="menu fade-in" role="menu">
          <button role="menuitem" className="menu-item" disabled={busy} onClick={deck}>
            {busy ? <Loader2 size={16} className="spin" /> : <Presentation size={16} />}<span><b>Dashboard deck</b><span className="xs mute">PowerPoint: charts, AI Compass, SWOT</span></span>
          </button>
          <button role="menuitem" className="menu-item" onClick={() => { downloadReport(s, audit, client); setOpen(false); }}>
            <FileText size={16} /><span><b>Full audit report</b><span className="xs mute">HTML: every answer, approval and log entry</span></span>
          </button>
          <button role="menuitem" className="menu-item" disabled={busy} onClick={() => doc('annex')}>
            <FileText size={16} /><span><b>Annex IV technical documentation</b><span className="xs mute">Word draft, EU AI Act, gaps marked</span></span>
          </button>
          <button role="menuitem" className="menu-item" disabled={busy} onClick={() => doc('dpdp')}>
            <FileText size={16} /><span><b>DPDP pack</b><span className="xs mute">Word draft: processing record and privacy notice</span></span>
          </button>
          <label className="menu-check xs"><input type="checkbox" checked={sdf} onChange={(e) => setSdf(e.target.checked)} /> Include the Significant Data Fiduciary part (impact assessment, audit)</label>
        </div>
      )}
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
          <div className="row"><h1>{s.name}</h1><TierBadge tier={r.tier} /></div>
          <p className="mute small" style={{ marginTop: 4 }}>{[s.code, role !== 'client' && client ? client.name : '', s.owner ? `Owner ${s.owner}` : '', s.bu].filter(Boolean).join(', ')}</p>
        </div>
        <div className="hero-stage">
          <div className="xs mute">Current stage</div>
          <div className="hero-stage-name"><span className="stage-chip">{s.stage}</span> {stageOf(s.stage).name}</div>
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <StatusPill status={s.status === 'Blocked' || s.status === 'Retired' ? s.status : STAGE_STATUS[rec?.status || 'open']} />
            <ProductDeadlines s={s} />
            {yourTurn && <span className="your-turn">{CAN.work(role) ? 'Your turn' : 'Needs your review'}</span>}
          </div>
        </div>
        <div className="row hero-btns">
          <button className="btn" onClick={() => nav(`/card/${s.id}`)}><BookMarked size={15} /> AI card</button>
          <ReportMenu s={s} audit={state.audit.filter((x) => x.target === s.id)} client={client} />
        </div>
      </section>
      <Tabs value={tab} onChange={setTab} tabs={[['lifecycle', 'Lifecycle'], ['overview', 'Risk and score'], ['assessment', 'Assessment'], ['data', 'Data and lineage'], ['actions', `Actions (${open})`], ['history', 'History'], ['record', 'Record']]} />
      <div key={tab} className="fade-in">
        {tab === 'overview' && <Results results={r} frameworks={s.assessment.frameworks} />}
        {tab === 'lifecycle' && <Lifecycle s={s} />}
        {tab === 'assessment' && <Assessment s={s} nav={nav} />}
        {tab === 'data' && <DataTab s={s} />}
        {tab === 'actions' && <Actions s={s} />}
        {tab === 'history' && <History s={s} />}
        {tab === 'record' && <RecordTab s={s} />}
      </div>
    </div>
  );
}

export { TIERS };
