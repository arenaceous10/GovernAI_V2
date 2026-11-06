import { useMemo, useRef, useState } from 'react';
import { Check, Loader2, Sparkles } from 'lucide-react';
import {
  ANNEX_III, DATA_CATEGORIES, DOMAINS, FRAMEWORKS, PROFILE_QUESTIONS, PROHIBITED, PRINCIPLES, PRINCIPLE_IDS, PILLARS,
  SOURCING, SYSTEM_TYPES, TRANSPARENCY, suggestFrameworks, selectionLabel, systemTypeLabel,
} from '../data/frameworks.js';
import { COUNTRIES, REGIONS } from '../data/countries.js';
import {
  emptyProfile, fixedQuestions, adaptiveTarget, selectAdaptive, aiAdaptive, orderQuestions, sectionOf, sectionOrder,
  scoreAssessment, buildActions, UNKNOWN,
} from '../engine/engine.js';
import { Field, Ladder, Multi, Panel, Single } from '../components/ui.jsx';
import Combobox from '../components/Combobox.jsx';
import { fwName } from '../components/Results.jsx';
import { cloud } from '../lib/cloud.js';
import { useStore } from '../store/store.jsx';

const STEPS = ['Product', 'Frameworks', 'Risk profile', 'Questionnaire', 'Review'];
const GEO_OPTIONS = [...REGIONS.map((r) => ({ value: r.code, label: r.name, group: true })), ...COUNTRIES.map((c) => ({ value: c.code, label: c.name }))];

function stepErrors(step, p, fws) {
  const e = [];
  if (step === 0) {
    if (!p.name.trim()) e.push('Product name');
    if (p.description.trim().length < 20) e.push('A short description (20 characters or more)');
    if (!p.domain) e.push('Business domain');
    if (p.domain === 'other' && !p.domainOther.trim()) e.push('Specify the business domain');
    if (!p.systemType) e.push('Type of AI');
    if (p.systemType === 'other' && !p.systemTypeOther.trim()) e.push('Specify the type of AI');
    if (!p.sourcing) e.push('Sourcing');
    if (p.sourcing === 'other' && !p.sourcingOther.trim()) e.push('Specify the sourcing');
    if (!p.geos.length) e.push('At least one country or region');
    if (!p.data.length) e.push('Data it uses');
  }
  if (step === 1 && !fws.length) e.push('At least one framework');
  if (step === 2) {
    const missing = PROFILE_QUESTIONS.filter((q) => p.answers[q.id] == null).length;
    if (missing) e.push(`${missing} risk profile question${missing > 1 ? 's' : ''}`);
    if (!p.prohibitedChecked) e.push('Prohibited practices');
    if (p.prohibitedAny === 'yes' && !p.prohibited.length) e.push('Which prohibited practice applies');
  }
  return e;
}

function initialState(existing) {
  const d = existing?.draft; const a = existing?.assessment;
  if (d) return { ...d, p: { ...emptyProfile(), ...d.p } };
  if (a) {
    return {
      p: { ...a.profile, prohibitedChecked: true, prohibitedAny: a.profile.prohibited?.length ? 'yes' : 'no' }, fws: a.frameworks,
      questions: a.questions, answers: a.answers, source: a.questionSource,
      builtKey: JSON.stringify([{ ...a.profile }, a.frameworks]), step: 0, maxStep: 4,
    };
  }
  return { p: { ...emptyProfile(), prohibitedChecked: false, prohibitedAny: '' }, fws: [], questions: [], answers: {}, source: '', builtKey: '', step: 0, maxStep: 0 };
}

const clean = (p) => { const x = { ...p }; delete x.prohibitedChecked; delete x.prohibitedAny; return x; };

function PillarHeading({ index, title, detail, count }) {
  return (
    <div className="pillar-head">
      <span className="pillar-index">{String(index).padStart(2, '0')}</span>
      <div className="pillar-title">
        <h3>{title}</h3>
        {detail && <p className="small mute">{detail}</p>}
      </div>
      {count && <span className="pillar-count num">{count}</span>}
    </div>
  );
}

export default function NewAssessment({ nav, existing }) {
  const { register, saveDraft, state } = useStore();
  const init = useMemo(() => initialState(existing), [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draftId, setDraftId] = useState(existing?.id || null);
  const [step, setStep] = useState(init.step || 0);
  const [maxStep, setMaxStep] = useState(init.maxStep || 0);
  const [p, setP] = useState(init.p);
  const [fws, setFws] = useState(init.fws);
  const [questions, setQuestions] = useState(init.questions);
  const [builtKey, setBuiltKey] = useState(init.builtKey);
  const [source, setSource] = useState(init.source);
  const [answers, setAnswers] = useState(init.answers);
  const [building, setBuilding] = useState(false);
  const [section, setSection] = useState(null);
  const [showErr, setShowErr] = useState(false);
  const [saved, setSaved] = useState('');
  const busy = useRef(false);

  const enabled = state.settings.enabledFrameworks || Object.keys(FRAMEWORKS);
  const reassess = existing && existing.status !== 'Draft';
  const eu = fws.includes('EU_AI_ACT');
  const up = (patch) => { setP((x) => ({ ...x, ...patch })); setSaved(''); };
  const errors = stepErrors(step, p, fws);
  const suggested = suggestFrameworks(p.geos).filter((k) => enabled.includes(k));
  const unanswered = questions.filter((q) => answers[q.id] == null).length;

  // EU-only screening is reset when the EU AI Act is not in scope.
  const profileFor = () => clean(eu ? p : { ...p, annex: 'none', transparency: [] });

  async function build() {
    const prof = profileFor();
    const key = JSON.stringify([prof, fws]);
    if (key === builtKey && questions.length) return;
    setBuilding(true);
    const overrides = state.bankOverrides || {};
    const custom = state.settings.customQuestions || [];
    const fixed = fixedQuestions(prof, fws, overrides, custom);
    const target = adaptiveTarget(fixed.length);
    let adaptive = []; let src = 'Rule-based tailoring';
    if (state.settings.aiQuestions) {
      // Names the AI must never see, on top of the product's own name, owner and business unit.
      const known = [...state.clients.map((c) => c.name), ...(state.users || []).map((u) => u.name), state.me?.name].filter(Boolean);
      // The endpoint only answers signed-in clients and administrators, so send the session token.
      const token = cloud ? (await cloud.auth.getSession()).data.session?.access_token : null;
      const ai = await aiAdaptive(prof, fws, target, fixed, { known, token });
      if (ai.questions.length) { adaptive = ai.questions; src = `AI (${ai.model || 'Gemini'})`; }
    }
    if (adaptive.length < target) adaptive = [...adaptive, ...selectAdaptive(prof, fws, target - adaptive.length, overrides, new Set(adaptive.map((q) => q.id)), custom)];
    const all = orderQuestions([...fixed, ...adaptive], fws);
    setQuestions(all);
    setAnswers((a) => Object.fromEntries(all.filter((q) => a[q.id] != null).map((q) => [q.id, a[q.id]])));
    setSource(src); setBuiltKey(key); setSection(null); setBuilding(false);
  }

  async function go(to) {
    if (busy.current) return;
    if (to > step && errors.length) { setShowErr(true); return; }
    setShowErr(false);
    busy.current = true;
    try {
      if (to >= 3 && step < 3) await build();
      if (to === 4 && step === 3 && unanswered > 0) { setShowErr(true); return; }
      setStep(to); setMaxStep((m) => Math.max(m, to));
      window.scrollTo({ top: 0 });
    } finally { busy.current = false; }
  }

  const meta = () => ({ name: p.name.trim() || 'Untitled product', bu: p.bu, owner: p.owner, description: p.description });

  function onSaveDraft() {
    const id = saveDraft(draftId, { p, fws, questions, answers, source, builtKey, step, maxStep }, meta());
    setDraftId(id);
    setSaved('Draft saved');
  }

  function submit() {
    if (unanswered) { setShowErr(true); return; }
    const profile = profileFor();
    const results = scoreAssessment(profile, fws, questions, answers, state.settings.cutoffs);
    const actions = buildActions(questions, answers, results.tier, new Date(), profile);
    const assessment = { at: new Date().toISOString(), by: state.role, profile, frameworks: fws, questions, answers, results, questionSource: source };
    const id = register(reassess ? existing.id : draftId, meta(), assessment, actions);
    nav(`/product/${id}`);
  }

  const sections = sectionOrder(fws).map((k) => ({ k, qs: questions.filter((q) => sectionOf(q, fws) === k) })).filter((s) => s.qs.length);
  const current = sections.some((s) => s.k === section) ? section : sections[0]?.k;
  const activeSection = sections.find((s) => s.k === current);
  const questionGroups = (() => {
    const groups = new Map();
    for (const q of activeSection?.qs || []) {
      const key = current === 'DG' ? `dg:${q.pillar || 'catalog'}` : `rai:${q.principle || 'accountability'}`;
      if (!groups.has(key)) groups.set(key, { key, qs: [] });
      groups.get(key).qs.push(q);
    }
    const principleOrder = new Map(PRINCIPLE_IDS.map((id, i) => [`rai:${id}`, i]));
    const pillarOrder = new Map(Object.keys(PILLARS).map((id, i) => [`dg:${id}`, i]));
    const order = current === 'DG' ? pillarOrder : principleOrder;
    return [...groups.values()].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  })();
  const answered = questions.length - unanswered;
  const firstUnanswered = questions.find((q) => answers[q.id] == null);
  const sel = (id, list, val, set, ph = 'Choose…') => (
    <select id={id} className="input" value={val ?? ''} onChange={(e) => set(e.target.value)}>
      <option value="" disabled>{ph}</option>
      {list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{reassess ? `Re-assess ${existing.name}` : existing ? `Continue ${existing.name}` : 'Register an AI product'}</h1>
          <p>{reassess ? 'Update the answers. The lifecycle stage stays where it is.' : 'Takes about 10 minutes. You can save a draft at any point.'}</p>
        </div>
      </div>

      <nav className="steps" aria-label="Registration steps">
        {STEPS.map((s, i) => (
          <button key={s} type="button" aria-current={i === step ? 'step' : undefined} className={i !== step && i <= maxStep ? 'done' : ''} disabled={i > maxStep} onClick={() => go(i)}>
            <span className="n">{i !== step && i <= maxStep ? <Check size={12} /> : i + 1}</span>{s}
          </button>
        ))}
      </nav>

      {showErr && (errors.length > 0 || step >= 3) && (
        <div className="callout bad" style={{ marginBottom: 16 }} role="alert">
          {errors.length ? <>Still needed: {errors.join(', ')}.</> : `${unanswered} question${unanswered === 1 ? '' : 's'} still unanswered.`}
        </div>
      )}
      {saved && <div className="callout good" style={{ marginBottom: 16 }}>{saved}. You can continue it later from AI products.</div>}

      {step === 0 && (
        <Panel>
          <div className="grid g3">
            <Field label="Product name"><input className="input" value={p.name} onChange={(e) => up({ name: e.target.value })} placeholder="e.g. Claims triage model" /></Field>
            <Field label="Business unit"><input className="input" value={p.bu} onChange={(e) => up({ bu: e.target.value })} placeholder="e.g. Claims" /></Field>
            <Field label="Accountable owner"><input className="input" value={p.owner} onChange={(e) => up({ owner: e.target.value })} placeholder="Full name" /></Field>
          </div>
          <div style={{ marginTop: 14 }}>
            <Field label="What does it do and who does it affect?"><textarea className="input" value={p.description} onChange={(e) => up({ description: e.target.value })} placeholder="Purpose, users, data sources and how outputs are used" /></Field>
          </div>
          <div className="grid g3" style={{ marginTop: 14 }}>
            <Field label="Business domain">{sel('domain', DOMAINS.map((d) => ({ value: d.id, label: d.label })), p.domain, (v) => up({ domain: v }))}</Field>
            <Field label="Type of AI">{sel('type', SYSTEM_TYPES.map((d) => ({ value: d.id, label: d.label })), p.systemType, (v) => up({ systemType: v }))}</Field>
            <Field label="Sourcing">{sel('sourcing', SOURCING.map((d) => ({ value: d.id, label: d.label })), p.sourcing, (v) => up({ sourcing: v }))}</Field>
          </div>
          {(p.domain === 'other' || p.systemType === 'other' || p.sourcing === 'other') && (
            <div className="grid g3" style={{ marginTop: 14 }}>
              {p.domain === 'other' && (
                <Field label="Specify the business domain">
                  <input className="input" value={p.domainOther} onChange={(e) => up({ domainOther: e.target.value })} placeholder="Describe the business domain" />
                </Field>
              )}
              {p.systemType === 'other' && (
                <Field label="Specify the type of AI">
                  <input className="input" value={p.systemTypeOther} onChange={(e) => up({ systemTypeOther: e.target.value })} placeholder="Describe the type of AI" />
                </Field>
              )}
              {p.sourcing === 'other' && (
                <Field label="Specify the sourcing">
                  <input className="input" value={p.sourcingOther} onChange={(e) => up({ sourcingOther: e.target.value })} placeholder="Describe how the AI is sourced" />
                </Field>
              )}
            </div>
          )}
          <div style={{ marginTop: 14 }}>
            <label className="field"><span>Countries where it is used or affects people</span></label>
            <Combobox label="Countries" options={GEO_OPTIONS} value={p.geos} onChange={(v) => up({ geos: v })} placeholder="Search countries" />
          </div>
          <div style={{ marginTop: 14 }}>
            <span className="small" style={{ fontWeight: 500, display: 'block', marginBottom: 6 }}>Data it uses</span>
            <Multi chips exclusive="none" options={DATA_CATEGORIES.map((g) => ({ value: g.id, label: g.label }))} value={p.data} onChange={(v) => up({ data: v })} />
          </div>
        </Panel>
      )}

      {step === 1 && (
        <div className="stack">
          <div className="grid g3">
            {enabled.map((k) => {
              const f = FRAMEWORKS[k]; const on = fws.includes(k);
              return (
                <button key={k} type="button" className="choice multi" role="checkbox" aria-checked={on} style={{ padding: 16, alignItems: 'flex-start' }}
                  onClick={() => { setFws(on ? fws.filter((x) => x !== k) : [...fws, k]); setSaved(''); }}>
                  <span className="dot" />
                  <span>
                    <span className="row" style={{ gap: 8 }}><b>{f.name}</b>{suggested.includes(k) && <span className="tag accent">Suggested</span>}</span>
                    <span className="small mute" style={{ display: 'block', marginTop: 4 }}>{f.blurb}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {suggested.length > 0 && fws.length === 0 && (
            <div><button type="button" className="btn" onClick={() => setFws(suggested)}>Use suggested: {suggested.map(fwName).join(', ')}</button></div>
          )}
          <p className="small mute">Responsible AI principles and data governance are always assessed.</p>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <div className="grid g2 risk-pillars">
            {PRINCIPLE_IDS.map((pid, index) => (
              <section className="panel risk-pillar" key={pid}>
                <PillarHeading index={index + 1} title={PRINCIPLES[pid].name} detail={PRINCIPLES[pid].tagline} count={`${PRINCIPLES[pid].weight}%`} />
                <div className="stack risk-pillar-questions">
                  {PROFILE_QUESTIONS.filter((q) => q.principle === pid).map((q) => (
                    <Field key={q.id} label={q.q}>
                      <Single
                        className="choices risk-options"
                        options={[...q.options.map((o, i) => ({ value: i, label: o.label })), { value: UNKNOWN, label: 'Not known' }]}
                        value={p.answers[q.id]}
                        onChange={(v) => up({ answers: { ...p.answers, [q.id]: v === UNKNOWN ? UNKNOWN : Number(v) } })}
                      />
                      {p.answers[q.id] === UNKNOWN && <p className="xs unknown-hint">Scored as the highest risk until confirmed. An action to find out is added.</p>}
                    </Field>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <Panel title="Regulatory screening" sub="Check prohibited practices and any applicable EU AI Act conditions.">
            <div className="grid g2">
              <Field label="Does it involve a prohibited practice, such as social scoring, manipulation or emotion recognition at work?">
                <Single className="choices risk-options compact-options" options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} value={p.prohibitedAny} onChange={(v) => up({ prohibitedAny: v, prohibitedChecked: true, prohibited: v === 'no' ? [] : p.prohibited })} />
              </Field>
              {eu && <Field label="Is it used in a sensitive area listed in the EU AI Act (Annex III)?"><Single className="choices risk-options" options={ANNEX_III.map((a) => ({ value: a.id, label: a.label }))} value={p.annex} onChange={(v) => up({ annex: v })} /></Field>}
            </div>
            {p.prohibitedAny === 'yes' && (
              <div style={{ marginTop: 14 }}>
                <Multi options={PROHIBITED.map((x) => ({ value: x, label: x }))} value={p.prohibited} onChange={(v) => up({ prohibited: v })} />
              </div>
            )}
            {eu && p.annex !== 'none' && (
              <div className="grid g2" style={{ marginTop: 14 }}>
                <Field label="Does it only do a narrow or preparatory task, without shaping the decision?"><Single className="choices risk-options compact-options" options={[{ value: 'no', label: 'No, it shapes or makes the decision' }, { value: 'yes', label: 'Yes, narrow or preparatory only' }]} value={p.narrowTask} onChange={(v) => up({ narrowTask: v })} /></Field>
                <Field label="Does it profile individuals?"><Single className="choices risk-options compact-options" options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} value={p.profiling} onChange={(v) => up({ profiling: v })} /></Field>
              </div>
            )}
            {eu && (
              <div style={{ marginTop: 14 }}>
                <span className="small" style={{ fontWeight: 500, display: 'block', marginBottom: 6 }}>How people meet the AI (tick any)</span>
                <Multi chips options={TRANSPARENCY.map((t) => ({ value: t.id, label: t.label }))} value={p.transparency} onChange={(v) => up({ transparency: v })} />
              </div>
            )}
          </Panel>
        </div>
      )}

      {step === 3 && (
        building ? <Panel><div className="empty"><Loader2 className="spin" size={22} /><p>Preparing questions for this product…</p></div></Panel> : (
          <div>
            <div className="tabs" role="tablist">
              {sections.map((s) => {
                const done = s.qs.filter((q) => answers[q.id] != null).length;
                return <button key={s.k} role="tab" aria-selected={current === s.k} onClick={() => setSection(s.k)}>{fwName(s.k)} <span className="xs mute num">{done}/{s.qs.length}</span></button>;
              })}
            </div>
            <div className="question-pillars">
              {questionGroups.map((group, index) => {
                const id = group.key.slice(group.key.indexOf(':') + 1);
                const title = current === 'DG' ? PILLARS[id]?.name || id : PRINCIPLES[id]?.name || id;
                const done = group.qs.filter((q) => answers[q.id] != null).length;
                return (
                  <section className="question-pillar" key={group.key}>
                    <PillarHeading index={index + 1} title={title} count={`${done}/${group.qs.length}`} />
                    {group.qs.map((q) => (
                      <div className="q" key={q.id}>
                        <div className="q-head">
                          <p className="q-text">{q.q}</p>
                          {q.kind !== 'core' && <span className="tag accent" title={q.why}>{q.source === 'ai' ? <><Sparkles size={11} /> Tailored</> : 'Tailored'}</span>}
                        </div>
                        <Ladder q={q} value={answers[q.id]} onChange={(v) => { setAnswers((a) => ({ ...a, [q.id]: v })); setSaved(''); }} />
                      </div>
                    ))}
                  </section>
                );
              })}
              <div className="spread" style={{ marginTop: 12 }}>
                <span className="xs mute">{answered} of {questions.length} answered</span>
                {sections.findIndex((s) => s.k === current) < sections.length - 1 && (
                  <button type="button" className="btn" onClick={() => { setSection(sections[sections.findIndex((s) => s.k === current) + 1].k); window.scrollTo({ top: 0 }); }}>Next section</button>
                )}
              </div>
            </div>
          </div>
        )
      )}

      {step === 4 && (
        <Panel>
          <dl className="kv">
            <dt>Product</dt><dd>{p.name}</dd>
            <dt>Business domain</dt><dd>{selectionLabel(DOMAINS, p.domain, p.domainOther)}</dd>
            <dt>Type of AI</dt><dd>{systemTypeLabel(p.systemType, p.systemTypeOther)}</dd>
            <dt>Sourcing</dt><dd>{selectionLabel(SOURCING, p.sourcing, p.sourcingOther)}</dd>
            <dt>Frameworks</dt><dd>{fws.map(fwName).join(', ')}</dd>
            <dt>Questions</dt><dd>{answered} of {questions.length} answered ({questions.filter((q) => q.kind === 'core').length} standard, {questions.filter((q) => q.kind !== 'core').length} tailored)</dd>
            <dt>Not known</dt><dd>{questions.filter((q) => answers[q.id] === UNKNOWN).length} control{questions.filter((q) => answers[q.id] === UNKNOWN).length === 1 ? '' : 's'}, {Object.values(p.answers).filter((v) => v === UNKNOWN).length} risk profile answer{Object.values(p.answers).filter((v) => v === UNKNOWN).length === 1 ? '' : 's'}. Each one is scored as the worst case and becomes a "find out" action.</dd>
          </dl>
          {unanswered > 0 && (
            <div className="callout bad" style={{ marginTop: 14 }}>
              {unanswered} unanswered. <button type="button" className="btn ghost sm" onClick={() => { setStep(3); setSection(sectionOf(firstUnanswered, fws)); }}>Go to the first one</button>
            </div>
          )}
          <p className="small mute" style={{ marginTop: 14 }}>{reassess ? 'The score and tier update straight away.' : 'Registering scores the product and opens stage 1 of the lifecycle.'}</p>
        </Panel>
      )}

      <div className="wizard-foot">
        <button type="button" className="btn" disabled={step === 0} onClick={() => go(step - 1)}>Back</button>
        <div className="row">
          {!reassess && <button type="button" className="btn" disabled={building} onClick={onSaveDraft}>Save draft</button>}
          {step < 4
            ? <button type="button" className="btn primary" disabled={building} onClick={() => go(step + 1)}>Continue</button>
            : <button type="button" className="btn primary" disabled={unanswered > 0} onClick={submit}>{reassess ? 'Save re-assessment' : 'Register product'}</button>}
        </div>
      </div>
    </div>
  );
}
