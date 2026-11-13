import { useState } from 'react';
import { FRAMEWORKS, SELECTABLE_FRAMEWORKS, TIER_ORDER, PRINCIPLES, PRINCIPLE_IDS, PROFILE_QUESTIONS, TIER_CUTOFFS, cutoffsFor, scaleFor } from '../data/frameworks.js';
import { LEVEL_NAMES, LEVEL_SCORES } from '../data/questionBank.js';
import { ROLES, STAGES, CORE_RULE, GATE_STAGES } from '../data/lifecycle.js';
import { evidenceCurrent, autoMaxAge } from '../data/freshness.js';
import { ADAPTIVE_SHARE } from '../engine/engine.js';
import { Panel, Pill, TierBadge, fmtDate, useShowMore } from '../components/ui.jsx';
import { useStore, waitingOn } from '../store/store.jsx';

export function ReviewQueue({ nav }) {
  const { state, role, systems } = useStore();
  const [tab, setTab] = useState('mine');
  const cname = (id) => state.clients.find((c) => c.id === id)?.name || '';
  const submitted = systems.filter((s) => s.stages?.[s.stage]?.status === 'submitted');
  const mine = submitted.filter((s) => { const w = waitingOn(s); return w.includes(role) || (role === 'lead' && w.includes('assessor')); });
  const returned = systems.filter((s) => s.stages?.[s.stage]?.status === 'returned');
  const rows = tab === 'mine' ? mine : tab === 'all' ? submitted : returned;
  const [shownRows, moreRows] = useShowMore(rows);
  return (
    <div>
      <div className="page-head"><div><h1>Review queue</h1></div></div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')}>Waiting for me ({mine.length})</button>
        <button role="tab" aria-selected={tab === 'all'} onClick={() => setTab('all')}>All submitted ({submitted.length})</button>
        <button role="tab" aria-selected={tab === 'returned'} onClick={() => setTab('returned')}>Returned to client ({returned.length})</button>
      </div>
      <Panel>
        {rows.length === 0 ? <div className="empty">Nothing here.</div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Product</th><th>Client</th><th>Stage</th><th>Tier</th><th>Evidence</th><th>{tab === 'returned' ? 'Returned because' : 'Waiting for'}</th><th>Submitted</th></tr></thead>
              <tbody>
                {shownRows.map((s) => {
                  const rec = s.stages[s.stage]; const st = STAGES[s.stage - 1];
                  const ev = st.evidence.filter((i) => evidenceCurrent(rec.evidence[i], { maxAgeDays: autoMaxAge(state.settings) })).length;
                  return (
                    <tr key={s.id} className="click" onClick={() => nav(`/product/${s.id}`)}>
                      <td><b style={{ fontWeight: 500 }}>{s.name}</b></td>
                      <td className="small">{cname(s.clientId)}</td>
                      <td className="small">{s.stage}. {st.short}</td>
                      <td><TierBadge tier={s.assessment.results.tier} /></td>
                      <td className="num small">{ev}/{st.evidence.length}</td>
                      <td className="small" style={{ maxWidth: 260 }}>{tab === 'returned' ? rec.returnNote : waitingOn(s).map((r) => ROLES[r].name).join(', ')}</td>
                      <td className="small">{fmtDate(rec.submittedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {moreRows}
          </div>
        )}
      </Panel>
    </div>
  );
}

export function ActionsPage({ nav }) {
  const { state, systems, role } = useStore();
  const [status, setStatus] = useState('open');
  const today = new Date().toISOString().slice(0, 10);
  const all = systems.filter((s) => s.assessment).flatMap((s) => s.actions.map((a) => ({ ...a, s })))
    .filter((a) => (status === 'open' ? a.status !== 'Done' : status === 'overdue' ? a.status !== 'Done' && a.due < today : a.status === 'Done'))
    .sort((a, b) => String(a.due || '').localeCompare(String(b.due || '')));
  const cnames = new Map(state.clients.map((c) => [c.id, c.name]));
  const [shownActions, moreActions] = useShowMore(all);
  return (
    <div>
      <div className="page-head">
        <div><h1>Actions</h1></div>
        <select className="input" aria-label="Show actions" style={{ width: 200 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option><option value="overdue">Overdue</option><option value="done">Done</option>
        </select>
      </div>
      <Panel>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Priority</th><th>Action</th><th>Product</th>{role !== 'client' && <th>Client</th>}<th>Owner</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {shownActions.map((a) => (
                <tr key={`${a.s.id}|${a.id}`} className="click" onClick={() => nav(`/product/${a.s.id}`)}>
                  <td><Pill tone={{ High: 'bad', Medium: 'warn', Low: 'ok' }[a.priority]}>{a.priority}</Pill></td>
                  <td style={{ maxWidth: 380 }}><b style={{ fontWeight: 500 }}>{a.topic}</b><div className="small mute">{a.action}</div></td>
                  <td className="small">{a.s.name}</td>
                  {role !== 'client' && <td className="small">{cnames.get(a.s.clientId)}</td>}
                  <td className="small">{a.owner || <span className="mute">Unassigned</span>}</td>
                  <td className={`num small ${a.status !== 'Done' && a.due < today ? 'tone-bad' : ''}`}>{a.due}</td>
                  <td><Pill tone={a.status === 'Done' ? 'good' : a.status === 'In progress' ? 'ok' : 'mute'}>{a.status}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
          {all.length === 0 && <div className="empty">No actions in this view.</div>}
          {moreActions}
        </div>
      </Panel>
    </div>
  );
}

export function AuditLog() {
  const { state, loadOlderAudit, sync } = useStore();
  const [who, setWho] = useState('');
  const [older, setOlder] = useState({ busy: false, done: false, error: '' });
  const names = new Map(state.systems.map((s) => [s.id, s.name]));
  const name = (id) => names.get(id) || (id ? 'Deleted draft' : '—');
  const cnames = new Map(state.clients.map((c) => [c.id, c.name]));
  const rows = state.audit.filter((x) => !who || x.actor === who);
  const [shown, more] = useShowMore(rows, 200);
  // The newest 800 entries load at sign-in; older ones come from the database on request.
  const loadOlder = async () => {
    setOlder({ busy: true, done: false, error: '' });
    try { const n = await loadOlderAudit(); setOlder({ busy: false, done: n === 0, error: '' }); }
    catch (e) { setOlder({ busy: false, done: false, error: e.message || 'Could not load older entries' }); }
  };
  return (
    <div>
      <div className="page-head">
        <div><h1>Audit log</h1></div>
        <select className="input" aria-label="Filter by role" style={{ width: 220 }} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">All roles</option>{Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.name}</option>)}
        </select>
      </div>
      <Panel>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Role</th><th>Action</th><th>Product</th><th>Detail</th></tr></thead>
            <tbody>
              {shown.map((x, i) => (
                <tr key={i}>
                  <td className="small num" style={{ whiteSpace: 'nowrap' }}>{x.at.slice(0, 16).replace('T', ' ')}</td>
                  <td className="small">{ROLES[x.actor]?.name || x.actor}{x.org && <div className="xs mute">{cnames.get(x.org)}</div>}</td>
                  <td className="small">{x.action}</td>
                  <td className="small">{name(x.target)}</td>
                  <td className="small mute">{x.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="empty">No entries.</div>}
          {more}
          {!more && sync.mode === 'cloud' && (
            <div className="show-more">
              <span className="xs mute">{older.error || (older.done ? 'No older entries.' : `Showing the newest ${state.audit.length} entries.`)}</span>
              {!older.done && <button type="button" className="btn sm" disabled={older.busy} onClick={loadOlder}>{older.busy ? 'Loading…' : 'Load older entries'}</button>}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

export function Methodology() {
  const { state } = useStore();
  const custom = state.settings.cutoffs || {};
  return (
    <div>
      <div className="page-head"><div><h1>How it works</h1></div></div>
      <div className="callout" style={{ marginBottom: 16 }}><b>Core rule.</b> {CORE_RULE}</div>

      <Panel title="Lifecycle at a glance">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Stage</th><th>Primary outcome</th><th>Minimum gate</th><th>Sign-off</th></tr></thead>
            <tbody>
              {STAGES.map((s) => (
                <tr key={s.n}>
                  <td><b style={{ fontWeight: 500 }}>{s.n}. {s.short}</b></td>
                  <td className="small">{s.outcome}</td>
                  <td className="small">{s.gate}</td>
                  <td className="xs mute">{GATE_STAGES.includes(s.n) ? 'Reviewer; lead too if High' : 'Reviewer'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="xs mute" style={{ marginTop: 8 }}>After go-live the product stays in stage 7. A material change opens stage 8 and an incident opens stage 9; both return to stage 7 when approved. Stage 10 retires it.</p>
      </Panel>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Panel title="Risk score: six Responsible AI principles" sub="Common to every framework.">
          <table className="table">
            <thead><tr><th>Principle</th><th>Weight</th><th>Questions</th></tr></thead>
            <tbody>{PRINCIPLE_IDS.map((p) => <tr key={p}><td>{PRINCIPLES[p].name}<div className="xs mute">{PRINCIPLES[p].tagline}</div></td><td className="num">{PRINCIPLES[p].weight}</td><td className="num">{PROFILE_QUESTIONS.filter((q) => q.principle === p).length}</td></tr>)}</tbody>
          </table>
          <ul className="list-plain xs mute" style={{ marginTop: 8 }}>
            <li>Each answer rates its principle 1 to 3. A principle's risk is 40% its worst item and 60% the average of its items, scaled to 0 to 100, so one serious exposure is not averaged away. The weighted total is the risk score.</li>
            <li>Stakes floor: when an output can decide access to something essential, or a failure can cause serious harm, no principle is rated below Medium.</li>
            <li>The type of AI is rated by how it is used: one step lower when a person makes every decision, one step higher when outputs take effect without review. Agents and biometric identification stay at the top rating.</li>
            <li>Controls lower a principle's risk by up to 35%, principle by principle. A principle earns no credit while one of its critical controls is not yet in place.</li>
            <li>Control credit is suspended while an incident is open, a high-priority action is overdue, or a model version in the registry has not been approved.</li>
            <li>Evidence and checks read from a connected model registry (Databricks or MLflow) are marked "auto-verified" with the day they were read. They count for {autoMaxAge(state.settings)} days; after that they are shown as out of date and are not counted until the registry is checked again. Evidence people attach does not expire.</li>
            <li>Products assessed before these rules keep the earlier method (plain averages, one overall control credit, cut-offs by law) until they are re-assessed, so a confirmed result can always be reproduced.</li>
          </ul>
        </Panel>
        <Panel title="Tier cut-offs" sub="One scale for every product. The laws in scope set legal floors and are reported one by one; they do not move the scale.">
          <table className="table">
            <thead><tr><th>Applies to</th><th>Limited from</th><th>High from</th></tr></thead>
            <tbody>
              <tr><td><b style={{ fontWeight: 600 }}>Every product</b></td><td className="num">{scaleFor(custom).limited}</td><td className="num">{scaleFor(custom).high}</td></tr>
              <tr><td colSpan={3} className="xs mute">Assessments made before the single scale, until re-assessed (the strictest law in scope applies):</td></tr>
              {SELECTABLE_FRAMEWORKS.map((k) => { const c = cutoffsFor([k], custom); return <tr key={k}><td>{FRAMEWORKS[k].name}</td><td className="num">{c.limited}</td><td className="num">{c.high}</td></tr>; })}
              <tr><td className="mute">No framework</td><td className="num">{(custom.DEFAULT || TIER_CUTOFFS.DEFAULT).limited}</td><td className="num">{(custom.DEFAULT || TIER_CUTOFFS.DEFAULT).high}</td></tr>
            </tbody>
          </table>
          <ul className="list-plain xs mute" style={{ marginTop: 8 }}>
            <li>Unacceptable: any prohibited practice, whatever the score.</li>
            <li>With the EU AI Act in scope, an Annex III use is at least High (unless narrow and no profiling), an Annex I product or safety component is High, and Art. 50 uses are at least Limited.</li>
            <li>GDPR and the DPDP Act set no tier. Their position (DPIA, Art. 22, Significant Data Fiduciary check, children's data) is shown beside the result.</li>
          </ul>
          <div className="row" style={{ marginTop: 10 }}>{TIER_ORDER.map((t) => <TierBadge key={t} tier={t} />)}</div>
        </Panel>
      </div>

      <Panel title="Questionnaire" style={{ marginTop: 16 }} sub={`About ${100 - ADAPTIVE_SHARE * 100}% standard questions per framework, about ${ADAPTIVE_SHARE * 100}% tailored to the product.`}>
        <table className="table small"><tbody>{LEVEL_NAMES.map((l, i) => <tr key={l}><td>Option {i + 1}</td><td>{l}</td><td className="num">{LEVEL_SCORES[i]} points</td></tr>)}</tbody></table>
      </Panel>
      <p className="xs mute" style={{ marginTop: 12 }}>Indicative assessment, not legal advice.</p>
    </div>
  );
}
