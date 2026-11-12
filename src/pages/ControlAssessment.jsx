// Control assessment: the control questions for a product, answered at stage 2 with evidence.
// The client answers and attaches evidence. The governance team reads the same page and can lower a rating.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import { PRINCIPLES, PRINCIPLE_IDS, PILLARS } from '../data/frameworks.js';
import { LEVEL_NAMES } from '../data/questionBank.js';
import { sectionOf, sectionOrder, isStaged, isProvisional, controlGaps, evidenceNeed, evidenceMet } from '../engine/engine.js';
import { Ladder, Panel, Pill, TierBadge, fmtDate } from '../components/ui.jsx';
import { fwName } from '../components/Results.jsx';
import { toast } from '../components/Extras.jsx';
import { useStore, CAN } from '../store/store.jsx';
import { EvidenceItem } from './Product.jsx';
import { consistencyFlags, evidenceReuse } from '../engine/governance.js';

const NEED_TEXT = {
  proof: 'Evidence needed: upload a file, or give a web link (https://…). You can add a few words before or after the link.',
  reference: 'Reference needed: say where this is documented or who owns it. A file is optional.',
};

function ReviewerRating({ q, answer, rating, canRate, onRate }) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const save = () => {
    const e = onRate(Number(level), reason);
    if (e) { setErr(e); return; }
    setOpen(false); setLevel(''); setReason(''); setErr('');
  };
  return (
    <div style={{ marginTop: 8 }}>
      {rating && typeof answer === 'number' && rating.rating < answer && (
        <div className="callout warn small">
          <b>Governance rating: {LEVEL_NAMES[rating.rating]}.</b> {rating.reason}
          <span className="xs mute"> {rating.byName || 'Governance team'}, {fmtDate(rating.at)}. The score uses this rating.</span>
          {canRate && <button type="button" className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => onRate(null)}>Remove</button>}
        </div>
      )}
      {canRate && typeof answer === 'number' && answer > 0 && !open && (
        <button type="button" className="btn sm" style={{ marginTop: rating ? 6 : 0 }} onClick={() => { setOpen(true); setLevel(String(rating ? rating.rating : answer - 1)); setReason(rating?.reason || ''); }}>
          {rating ? 'Change rating' : 'Lower rating'}
        </button>
      )}
      {open && (
        <div className="row" style={{ marginTop: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <select className="input" style={{ width: 'auto' }} aria-label={`Governance rating for: ${q.q}`} value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVEL_NAMES.slice(0, answer).map((l, i) => <option key={l} value={i}>{l}</option>)}
          </select>
          <input className="input" style={{ flex: 1, minWidth: 220 }} aria-label="Reason for the lower rating" placeholder="Reason, shown to the client" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className="btn primary sm" onClick={save}>Save rating</button>
          <button type="button" className="btn ghost sm" onClick={() => { setOpen(false); setErr(''); }}>Cancel</button>
          {err && <p className="xs" style={{ color: 'var(--bad)', width: '100%' }}>{err}</p>}
        </div>
      )}
    </div>
  );
}

export default function ControlAssessment({ id, nav }) {
  const { getSystem, role, saveControls, rateControl, prepareControls } = useStore();
  const s = getSystem(id);
  const a = s?.assessment;
  const staged = !!s && s.status !== 'Draft' && isStaged(a);
  const withTeam = staged && s.stage === 2 && s.stages?.[2]?.status === 'submitted';
  const canEdit = staged && CAN.work(role) && !['Retired', 'Withdrawn', 'Blocked'].includes(s.status) && !withTeam;
  const canRate = staged && CAN.review(role) && !['Retired', 'Withdrawn'].includes(s.status);

  const [questions, setQuestions] = useState(a?.questions || []);
  const [answers, setAnswers] = useState(a?.answers || {});
  const [evidence, setEvidence] = useState(a?.evidence || {});
  const [source, setSource] = useState(a?.questionSource || '');
  const [building, setBuilding] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [section, setSection] = useState(null);
  const [showGaps, setShowGaps] = useState(false);
  const latest = useRef(null);
  latest.current = { questions, answers, evidence, source, dirty, canEdit };

  // Questions are written in the background when the product is registered. Opened before they are ready, this
  // waits for that same call (or starts it for products registered earlier).
  useEffect(() => {
    if (!canEdit || a?.questions?.length) return;
    setBuilding(true);
    Promise.resolve(prepareControls(id)).finally(() => setBuilding(false));
  }, [canEdit, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!questions.length && a?.questions?.length) { setQuestions(a.questions); setSource(a.questionSource || ''); }
  }, [a?.questions]); // eslint-disable-line react-hooks/exhaustive-deps

  // The governance team sees the saved answers, and picks up changes the client makes meanwhile.
  useEffect(() => {
    if (canEdit || !a) return;
    setQuestions(a.questions || []); setAnswers(a.answers || {}); setEvidence(a.evidence || {});
  }, [canEdit, a?.controlsAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (next = {}) => {
    const cur = { ...latest.current, ...next };
    if (!cur.canEdit || !cur.questions.length) return;
    saveControls(id, { questions: cur.questions, answers: cur.answers, evidence: cur.evidence, source: cur.source });
    setDirty(false);
  };
  // Leaving the page keeps what was answered.
  useEffect(() => () => { if (latest.current.dirty) persist(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fws = a?.frameworks || [];
  const sections = useMemo(() => sectionOrder(fws).map((k) => ({ k, qs: questions.filter((q) => sectionOf(q, fws) === k) })).filter((x) => x.qs.length), [questions, fws]);
  if (!staged) return <div className="panel empty">This product has no control assessment. <button className="btn ghost" onClick={() => nav(s ? `/product/${s.id}` : '/products')}>Back</button></div>;

  const tier = a.results?.inherentTier;
  const gaps = controlGaps({ ...a, questions, answers, evidence });
  const current = sections.some((x) => x.k === section) ? section : sections[0]?.k;
  const active = sections.find((x) => x.k === current);
  const groups = (() => {
    const m = new Map();
    for (const q of active?.qs || []) {
      const key = current === 'DG' ? `dg:${q.pillar || 'catalog'}` : `rai:${q.principle || 'accountability'}`;
      if (!m.has(key)) m.set(key, { key, qs: [] });
      m.get(key).qs.push(q);
    }
    const order = new Map((current === 'DG' ? Object.keys(PILLARS).map((x) => `dg:${x}`) : PRINCIPLE_IDS.map((x) => `rai:${x}`)).map((k, i) => [k, i]));
    return [...m.values()].sort((x, y) => (order.get(x.key) ?? 99) - (order.get(y.key) ?? 99));
  })();
  const sectionGaps = (qs) => qs.filter((q) => gaps.unansweredIds.includes(q.id) || gaps.unsupportedIds.includes(q.id)).length;
  const idx = sections.findIndex((x) => x.k === current);
  const lowered = Object.entries(a.review || {}).filter(([k, r]) => typeof a.answers?.[k] === 'number' && r.rating < a.answers[k]).length;
  // For the reviewer: answers that contradict the risk profile, and evidence reused across many controls.
  const flags = canRate ? consistencyFlags(a.profile, a.frameworks, questions, a.answers || {}) : [];
  const reuse = canRate ? evidenceReuse(a.evidence) : [];
  const topicOf = (id) => questions.find((q) => q.id === id)?.topic || id;

  const setAnswer = (q, v) => { setAnswers((x) => ({ ...x, [q.id]: v })); setDirty(true); };
  const setEv = (q, v) => {
    const next = { ...evidence }; if (v) next[q.id] = v; else delete next[q.id];
    setEvidence(next); persist({ evidence: next });   // files are stored at once, so the answer is saved with them
  };

  return (
    <div className="fade-in">
      <button className="btn ghost back" onClick={() => nav(`/product/${s.id}`)}><ArrowLeft size={16} /> Back to {s.name}</button>
      <div className="page-head">
        <div>
          <h1>Control assessment</h1>
          <p>{s.name}. {canEdit ? 'Rate each control as it stands today and back it with evidence. You can save and come back.' : canRate ? 'The client\'s ratings and evidence. You can lower a rating with a reason; the score then uses yours.' : 'The control ratings and evidence for this product.'}</p>
        </div>
        <div className="row" style={{ gap: 8 }}><TierBadge tier={a.results.tier} />{isProvisional(a) && <span className="tag">Provisional</span>}</div>
      </div>

      {isProvisional(a) && <div className="callout small" style={{ marginBottom: 14 }}>The tier is provisional: it rests on the risk profile alone until the governance team approves stage 2. Controls can only bring it down.</div>}
      {flags.length > 0 && (
        <div className="callout warn small" style={{ marginBottom: 14 }}><b>{flags.length} answer{flags.length > 1 ? 's do' : ' does'} not fit the risk profile.</b> Check these before you approve; lower the rating or return the stage if the answer cannot be supported.
          <ul className="list-plain" style={{ marginTop: 6 }}>{flags.map((f) => <li key={f.id}>{f.text} <span className="mute">({f.qids.map(topicOf).join(', ')})</span></li>)}</ul></div>
      )}
      {reuse.length > 0 && (
        <div className="callout warn small" style={{ marginBottom: 14 }}><b>The same evidence backs several controls.</b> {reuse.map((g) => `"${g.label}" is used for ${g.count} controls (${g.items.map(topicOf).slice(0, 4).join(', ')}${g.items.length > 4 ? '…' : ''})`).join('; ')}. Check that it really covers each one.</div>
      )}
      {withTeam && CAN.work(role) && <div className="callout small" style={{ marginBottom: 14 }}><b>With the governance team.</b> Stage 2 is submitted, so the answers are locked until they decide.</div>}
      {!canEdit && !questions.length && <Panel><div className="empty"><p>The client has not started the control assessment yet.</p></div></Panel>}
      {building && <Panel><div className="empty"><Loader2 className="spin" size={22} /><p>Preparing questions for this product…</p></div></Panel>}

      {!building && questions.length > 0 && (
        <div>
          <div className="tabs" role="tablist">
            {sections.map((x) => {
              const left = sectionGaps(x.qs);
              return <button key={x.k} role="tab" aria-selected={current === x.k} onClick={() => setSection(x.k)}>{fwName(x.k)} <span className="xs mute num">{x.qs.length - left}/{x.qs.length}</span></button>;
            })}
          </div>
          <div className="question-pillars">
            {groups.map((g, gi) => {
              const gid = g.key.slice(g.key.indexOf(':') + 1);
              const title = current === 'DG' ? PILLARS[gid]?.name || gid : PRINCIPLES[gid]?.name || gid;
              return (
                <section className="question-pillar" key={g.key}>
                  <div className="pillar-head">
                    <span className="pillar-index">{String(gi + 1).padStart(2, '0')}</span>
                    <div className="pillar-title"><h3>{title}</h3></div>
                    <span className="pillar-count num">{g.qs.length - sectionGaps(g.qs)}/{g.qs.length}</span>
                  </div>
                  {g.qs.map((q) => {
                    const v = answers[q.id];
                    const need = evidenceNeed(q, v, tier);
                    const ev = evidence[q.id];
                    const missing = showGaps && (v == null || !evidenceMet(need, ev));
                    return (
                      <div className="q" key={q.id} id={`q-${q.id}`} style={missing ? { boxShadow: 'inset 3px 0 0 var(--bad)', paddingLeft: 12 } : undefined}>
                        <div className="q-head">
                          <p className="q-text">{q.q}</p>
                          <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                            {q.weight === 3 && <span className="tag">Critical</span>}
                            {q.kind !== 'core' && <span className="tag accent" title={q.why}>{q.source === 'ai' ? <><Sparkles size={11} /> Tailored</> : 'Tailored'}</span>}
                          </span>
                        </div>
                        {canEdit
                          ? <Ladder q={q} value={v} onChange={(x) => setAnswer(q, x)} />
                          : <p className="small" style={{ marginTop: 6 }}>{v == null ? <Pill tone="warn">Not answered</Pill> : v === 'na' ? <Pill>Not applicable</Pill> : v === 'unknown' ? <Pill tone="warn">Not known</Pill> : <><Pill tone={['bad', 'warn', 'ok', 'good'][v]}>{LEVEL_NAMES[v]}</Pill> <span className="mute">{q.options[v]}</span></>}</p>}
                        {(need || ev) && (
                          <div style={{ marginTop: 8 }}>
                            {need && canEdit && !evidenceMet(need, ev) && <p className="xs" style={{ color: missing ? 'var(--bad)' : 'var(--mute)', marginBottom: 2 }}>{NEED_TEXT[need]}</p>}
                            {(canEdit || ev)
                              ? <EvidenceItem item={need === 'reference' ? 'Reference or evidence' : 'Evidence'} value={ev} editable={canEdit} systemId={s.id} stage={2} onSave={(val) => setEv(q, val)} />
                              : need && <p className="xs mute">Nothing attached.</p>}
                          </div>
                        )}
                        <ReviewerRating q={q} answer={a.answers?.[q.id]} rating={a.review?.[q.id]} canRate={canRate && a.answers?.[q.id] === v}
                          onRate={(level, reason) => { const e = rateControl(s.id, q.id, level, reason); if (!e) toast(level == null ? 'Rating removed' : 'Rating saved'); return e; }} />
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>

          <div className="wizard-foot">
            <span className="small mute" role="status">
              {gaps.complete ? 'Every control is answered and backed.' : [gaps.unanswered ? `${gaps.unanswered} to answer` : '', gaps.unsupported ? `${gaps.unsupported} need evidence` : ''].filter(Boolean).join(', ')}
              {lowered ? `. ${lowered} rating${lowered > 1 ? 's' : ''} lowered by the governance team` : ''}
              {canEdit && dirty ? '. Unsaved changes' : ''}
            </span>
            <div className="row">
              {!gaps.complete && canEdit && <button type="button" className="btn" onClick={() => {
                setShowGaps(true);
                const first = questions.find((q) => gaps.unansweredIds.includes(q.id) || gaps.unsupportedIds.includes(q.id));
                if (first) { setSection(sectionOf(first, fws)); setTimeout(() => document.getElementById(`q-${first.id}`)?.scrollIntoView({ block: 'center' }), 60); }
              }}>Show what is missing</button>}
              {idx < sections.length - 1 && <button type="button" className="btn" onClick={() => { setSection(sections[idx + 1].k); window.scrollTo({ top: 0 }); }}>Next section</button>}
              {canEdit && <button type="button" className="btn primary" onClick={() => { persist(); toast(gaps.complete ? 'Control assessment complete' : 'Saved'); if (gaps.complete) nav(`/product/${s.id}`); }}>{gaps.complete ? 'Save and finish' : 'Save progress'}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
