import { useState } from 'react';
import { ArrowLeft, ChevronDown, Download, Paperclip, RefreshCw, X } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TIERS, DOMAINS, SYSTEM_TYPES, SOURCING, PRINCIPLES } from '../data/frameworks.js';
import { geoName } from '../data/countries.js';
import { STAGES, stageOf, requiredApprovals, ROLES, STAGE_STATUS, GATE_STAGES } from '../data/lifecycle.js';
import { LEVEL_NAMES } from '../data/questionBank.js';
import { sectionOf, sectionOrder } from '../engine/engine.js';
import { downloadReport } from '../engine/report.js';
import { Panel, Pill, Tabs, TierBadge, fmtDate, StatusPill, Field } from '../components/ui.jsx';
import { StageTracker } from '../components/Stages.jsx';
import Results, { fwName } from '../components/Results.jsx';
import DataAssets, { catalogCoverage } from '../components/DataAssets.jsx';
import LineageGraph from '../components/LineageGraph.jsx';
import { useStore, stageBlockers, waitingOn, newStage } from '../store/store.jsx';

const label = (list, id) => list.find((x) => x.id === id)?.label || id || '—';

function EvidenceItem({ item, value, editable, onSave }) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState(value?.ref || '');
  const has = value && (value.ref || value.file);
  return (
    <div className="ev-row">
      <div>
        <div>{item}</div>
        {has && !open && <div className="xs mute" style={{ marginTop: 2 }}><Paperclip size={11} /> {value.file || value.ref}</div>}
        {open && (
          <div className="row" style={{ marginTop: 8 }}>
            <input className="input" style={{ flex: 1, minWidth: 200 }} aria-label={`Link or document name for ${item}`} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Link or document name" />
            <label className="btn sm" style={{ cursor: 'pointer' }}>Upload file
              <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { onSave({ ref, file: f.name }); setOpen(false); } e.target.value = ''; }} />
            </label>
            <button type="button" className="btn primary sm" disabled={!ref.trim()} onClick={() => { onSave({ ref: ref.trim(), file: value?.file || '' }); setOpen(false); }}>Save</button>
            <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 6 }}>
        {has ? <Pill tone="good">Attached</Pill> : <Pill>Not attached</Pill>}
        {editable && !open && <button type="button" className="btn sm" onClick={() => { setRef(value?.ref || ''); setOpen(true); }}>{has ? 'Change' : 'Attach'}</button>}
        {editable && has && !open && <button type="button" className="btn ghost sm" aria-label={`Remove evidence for ${item}`} onClick={() => onSave(null)}><X size={14} /></button>}
      </div>
    </div>
  );
}

function ReviewBox({ s, n, rec }) {
  const { role, reviewStage } = useStore();
  const [comment, setComment] = useState('');
  const tier = s.assessment.results.tier;
  const need = requiredApprovals(n, tier);
  const waiting = waitingOn(s);
  const mySlot = waiting.includes(role) ? role : (role === 'lead' && waiting.includes('assessor') && !need.includes('lead') ? 'lead' : null);
  return (
    <Panel title="Review" sub={`Needs ${need.map((r) => ROLES[r].name.toLowerCase()).join(' and ')} sign-off.`}>
      {need.map((r) => {
        const a = rec.approvals?.[r];
        return (
          <div key={r} className="spread" style={{ padding: '6px 0' }}>
            <span className="small">{ROLES[r].name}</span>
            {a ? <Pill tone={a.outcome === 'Returned' ? 'warn' : 'good'}>{a.outcome}</Pill> : <Pill>Waiting</Pill>}
          </div>
        );
      })}
      {rec.note && <p className="small mute" style={{ marginTop: 8 }}>Note from submitter: {rec.note}</p>}
      {mySlot && (
        <div style={{ marginTop: 12 }}>
          <Field label="Comment"><input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Required to return or add conditions" /></Field>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={() => reviewStage(s.id, n, mySlot, 'Approved', comment.trim())}>Approve</button>
            {(n === 6 || GATE_STAGES.includes(n)) && <button className="btn" disabled={comment.trim().length < 5} onClick={() => reviewStage(s.id, n, mySlot, 'Approved with conditions', comment.trim())}>Approve with conditions</button>}
            <button className="btn danger" disabled={comment.trim().length < 5} onClick={() => reviewStage(s.id, n, mySlot, 'Returned', comment.trim())}>Return</button>
          </div>
        </div>
      )}
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
  const canEdit = isCurrent && role !== 'admin' && ['open', 'returned'].includes(rec.status);
  const blockers = stageBlockers(s);
  const doneCount = st.checklist.filter((i) => rec.checklist[i]).length;
  const evCount = st.evidence.filter((i) => rec.evidence[i]).length;
  const status = isCurrent || rec.status === 'approved' ? STAGE_STATUS[rec.status] : 'Not started';
  return (
    <div className="stack">
      <Panel>
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <h2>Stage {n}: {st.name}</h2>
            <p className="mute small" style={{ marginTop: 4, maxWidth: '70ch' }}>{st.objective}</p>
          </div>
          <StatusPill status={status} />
        </div>
        {rec.status === 'returned' && rec.returnNote && <div className="callout warn" style={{ marginTop: 12 }}><b>Returned:</b> {rec.returnNote}</div>}
        {rec.conditions && <div className="callout" style={{ marginTop: 12 }}><b>Conditions:</b> {rec.conditions}</div>}
        <button type="button" className="btn ghost sm" style={{ marginTop: 8, paddingLeft: 0 }} aria-expanded={howOpen} onClick={() => setHowOpen(!howOpen)}>
          <ChevronDown size={14} style={{ transform: howOpen ? 'rotate(180deg)' : 'none' }} /> How to complete this stage
        </button>
        {howOpen && <ol className="list-plain small" style={{ marginTop: 4 }}>{st.process.map((x) => <li key={x}>{x}</li>)}</ol>}
      </Panel>

      <div className="grid g2">
        <Panel title="Checklist" right={<span className="small mute num">{doneCount}/{st.checklist.length}</span>}>
          {st.checklist.map((item) => (
            <label key={item} className="check-row" style={{ cursor: canEdit ? 'pointer' : 'default' }}>
              <input type="checkbox" disabled={!canEdit} checked={!!rec.checklist[item]} onChange={() => toggleCheck(s.id, n, item)} />
              <span>{item}</span>
            </label>
          ))}
          {canEdit && doneCount < st.checklist.length && <button type="button" className="btn ghost sm" style={{ marginTop: 6, paddingLeft: 0 }} onClick={() => checkAll(s.id, n, st.checklist)}>Tick all</button>}
        </Panel>
        <Panel title="Evidence" right={<span className="small mute num">{evCount}/{st.evidence.length}</span>}>
          {st.evidence.map((item) => (
            <EvidenceItem key={`${n}-${item}`} item={item} value={rec.evidence[item]} editable={canEdit} onSave={(v) => setEvidence(s.id, n, item, v)} />
          ))}
        </Panel>
      </div>

      <div className="gate"><b>Exit gate</b><span>{st.exit}</span></div>

      {isCurrent && ['open', 'returned'].includes(rec.status) && role !== 'admin' && (
        <Panel>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 240 }}><Field label="Note for the reviewer"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
            <button className="btn primary" disabled={blockers.length > 0} onClick={() => { submitStage(s.id, n, note.trim()); setNote(''); }}>
              {n === 7 ? 'Submit periodic review' : 'Submit for review'}
            </button>
          </div>
          {blockers.length > 0 && <p className="xs mute" style={{ marginTop: 6 }}>{blockers.join('. ')}.</p>}
        </Panel>
      )}
      {isCurrent && rec.status === 'submitted' && <ReviewBox s={s} n={n} rec={rec} />}

      {isCurrent && role === 'lead' && rec.status !== 'approved' && (
        <Panel title="Override gate" sub="Moves the product on without the remaining sign-offs. The reason is recorded in the audit log.">
          <div className="row">
            <input className="input" aria-label="Override reason" style={{ flex: 1, minWidth: 240 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (at least 15 characters)" />
            <button className="btn danger" disabled={reason.trim().length < 15} onClick={() => { override(s.id, n, reason.trim()); setReason(''); }}>Override</button>
          </div>
        </Panel>
      )}

      {isCurrent && n === 7 && role !== 'admin' && (
        <Panel title="Something changed?">
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label="Type">
              <select className="input" value={event.kind} onChange={(e) => setEvent({ ...event, kind: e.target.value })}>
                <option value="">Choose…</option><option value="change">Material change</option><option value="incident">AI incident</option><option value="retire">Retire the product</option>
              </select>
            </Field>
            <div style={{ flex: 1, minWidth: 240 }}><Field label="What happened"><input className="input" value={event.text} onChange={(e) => setEvent({ ...event, text: e.target.value })} /></Field></div>
            <button className="btn" disabled={!event.kind || event.text.trim().length < 5} onClick={() => { startEvent(s.id, event.kind, event.text.trim()); setEvent({ kind: '', text: '' }); }}>
              {{ change: 'Start change review', incident: 'Report incident', retire: 'Start retirement', '': 'Start' }[event.kind]}
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}

function Lifecycle({ s }) {
  const [view, setView] = useState(s.stage);
  return (
    <div className="stack">
      <Panel><StageTracker stage={s.stage} status={s.status} stages={s.stages} viewing={view} onPick={setView} /></Panel>
      {s.status === 'Blocked' && <div className="callout bad">Prohibited practice. This product cannot move through the lifecycle.</div>}
      {view !== s.stage && <div className="callout small">Viewing stage {view}. <button className="btn ghost sm" onClick={() => setView(s.stage)}>Back to the current stage</button></div>}
      <StageView key={`${view}-${s.stage}`} s={s} n={view} />
    </div>
  );
}

function Assessment({ s, nav }) {
  const { role } = useStore();
  const a = s.assessment; const fws = a.frameworks; const p = a.profile;
  return (
    <div className="stack">
      <Panel title="Product details" right={role !== 'admin' && s.status !== 'Retired' && <button className="btn sm" onClick={() => nav(`/reassess/${s.id}`)}><RefreshCw size={14} /> Re-assess</button>}>
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
                <td><input className="input" aria-label={`Owner of ${a.topic}`} disabled={role === 'admin'} style={{ width: 150, padding: '5px 8px' }} value={a.owner} onChange={(e) => updateAction(s.id, a.id, { owner: e.target.value })} placeholder="Unassigned" /></td>
                <td className={`num small ${a.status !== 'Done' && a.due < today ? 'tone-bad' : ''}`}>{a.due}</td>
                <td>
                  <select className="input" aria-label={`Status of ${a.topic}`} disabled={role === 'admin'} style={{ width: 130, padding: '5px 8px' }} value={a.status} onChange={(e) => updateAction(s.id, a.id, { status: e.target.value })}>
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
      <Panel title="Lineage" right={!edit && role !== 'admin' && <button className="btn sm" onClick={() => { setD(s.datasets); setO(s.outputs); setEdit(true); }}>Edit data assets</button>}>
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
  const [tab, setTab] = useState('overview');
  const s = getSystem(id);
  if (!s) return <div className="panel empty">This product was not found. <button className="btn ghost" onClick={() => nav(back)}>Back</button></div>;
  if (s.status === 'Draft') return <div className="panel empty">This product is still a draft. <button className="btn primary" onClick={() => nav(`/draft/${s.id}`)}>Continue registration</button></div>;
  const r = s.assessment.results;
  const client = state.clients.find((c) => c.id === s.clientId);
  const open = s.actions.filter((x) => x.status !== 'Done').length;
  const rec = s.stages?.[s.stage];
  return (
    <div>
      <button className="btn ghost" style={{ marginBottom: 8, paddingLeft: 0 }} onClick={() => nav(back)}><ArrowLeft size={16} /> Back</button>
      <div className="page-head">
        <div>
          <div className="row"><h1>{s.name}</h1><TierBadge tier={r.tier} /><StatusPill status={s.status} /></div>
          <p>{role !== 'client' && client ? `${client.name}, ` : ''}{s.code}. Stage {s.stage} of 10: {stageOf(s.stage).name}{rec ? `, ${STAGE_STATUS[rec.status].toLowerCase()}` : ''}.</p>
        </div>
        <button className="btn" onClick={() => downloadReport(s, state.audit.filter((x) => x.target === s.id), client)}><Download size={15} /> Report</button>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[['overview', 'Overview'], ['lifecycle', 'Lifecycle'], ['assessment', 'Assessment'], ['data', 'Data and lineage'], ['actions', `Actions (${open})`], ['history', 'History']]} />
      {tab === 'overview' && <Results results={r} frameworks={s.assessment.frameworks} />}
      {tab === 'lifecycle' && <Lifecycle s={s} />}
      {tab === 'assessment' && <Assessment s={s} nav={nav} />}
      {tab === 'data' && <DataTab s={s} />}
      {tab === 'actions' && <Actions s={s} />}
      {tab === 'history' && <History s={s} />}
    </div>
  );
}

export { TIERS };
