// Analysis for the dashboard deck and the product views: SWOT, "what if" opportunities and key messages.
// Every statement is computed from the product's own data; nothing is written by an AI model.
import { PRINCIPLES, PRINCIPLE_IDS, TIERS } from '../data/frameworks.js';
import { STAGES } from '../data/lifecycle.js';
import { deadlinesFor } from '../data/deadlines.js';
import { controlStatus, compassScores, COMPASS, COMPASS_IDS, itemState } from '../data/controls.js';
import { scoreAssessment, sectionName, sectionOrder, isUnknown } from './engine.js';

const today = () => new Date().toISOString().slice(0, 10);

// Residual score if every "Started" control reached "In place", and if every "Not known" were found to be "In place".
export function whatIf(s) {
  const a = s.assessment; if (!a) return null;
  const run = (answers) => scoreAssessment(a.profile, a.frameworks, a.questions, answers).residual;
  const started = a.questions.filter((q) => a.answers[q.id] === 1).map((q) => q.id);
  const unknown = a.questions.filter((q) => isUnknown(a.answers[q.id])).map((q) => q.id);
  const bump = (ids, to) => ({ ...a.answers, ...Object.fromEntries(ids.map((id) => [id, to])) });
  return {
    now: a.results.residual,
    started: started.length, afterStarted: started.length ? run(bump(started, 2)) : a.results.residual,
    unknown: unknown.length, afterUnknown: unknown.length ? run(bump(unknown, 2)) : a.results.residual,
  };
}

export function answerMix(s) {
  const a = s.assessment; const fws = a.frameworks;
  const rows = sectionOrder(fws).map((k) => {
    const qs = a.questions.filter((q) => q.maps[k]);
    const c = { k, name: sectionName(k), 'Not in place': 0, Started: 0, 'In place': 0, Evidenced: 0, 'Not known': 0, 'Not applicable': 0 };
    for (const q of qs) {
      const v = a.answers[q.id];
      if (v === 'na') c['Not applicable']++; else if (isUnknown(v)) c['Not known']++; else if (v != null) c[['Not in place', 'Started', 'In place', 'Evidenced'][v]]++;
    }
    return c;
  }).filter((r) => r['Not in place'] + r.Started + r['In place'] + r.Evidenced + r['Not known'] + r['Not applicable'] > 0);
  return rows;
}

export function checklistByStage(s) {
  return STAGES.filter((st) => s.stages?.[st.n]).map((st) => {
    const rec = s.stages[st.n];
    const states = st.checklist.map((i) => itemState(rec, i));
    return { n: st.n, name: st.short, status: rec.status, done: states.filter((x) => x === 'done').length, skipped: states.filter((x) => x === 'skipped').length, open: states.filter((x) => x === 'open').length,
      skips: st.checklist.filter((i) => rec.skipped?.[i]).map((i) => ({ item: i, ...rec.skipped[i] })) };
  });
}

export function swot(s, rules = {}) {
  const r = s.assessment.results;
  const S = []; const W = []; const O = []; const T = [];
  const pr = PRINCIPLE_IDS.map((k) => ({ k, ...r.principles[k] }));
  const ctl = controlStatus(s, rules);
  const comp = compassScores(s).scores;

  // Strengths
  pr.filter((p) => (p.readiness ?? 0) >= 70).sort((a, b) => b.readiness - a.readiness).slice(0, 2)
    .forEach((p) => S.push(`${PRINCIPLES[p.k].name}: ${p.readiness}% of controls in place`));
  Object.entries(r.frameworks).filter(([, f]) => (f.score ?? 0) >= 85).slice(0, 2).forEach(([k, f]) => S.push(`${sectionName(k)} readiness ${f.score}%: ${f.status.label}`));
  const operating = ctl.filter((c) => c.status === 'Operating').length;
  if (operating) S.push(`${operating} of ${ctl.length} lifecycle controls operating with every check confirmed`);
  const approved = STAGES.filter((st) => s.stages?.[st.n]?.status === 'approved').length;
  if (approved) S.push(`${approved} lifecycle stage${approved > 1 ? 's' : ''} approved by the governance team`);
  const bestC = COMPASS_IDS.filter((k) => comp[k] != null).sort((a, b) => comp[b] - comp[a])[0];
  if (bestC && comp[bestC] >= 70) S.push(`Strongest Compass direction: ${COMPASS[bestC].name} (${comp[bestC]})`);

  // Weaknesses
  pr.filter((p) => p.readiness != null && p.readiness < 50).sort((a, b) => a.readiness - b.readiness).slice(0, 2)
    .forEach((p) => W.push(`${PRINCIPLES[p.k].name}: only ${p.readiness}% of controls in place`));
  const crit = r.criticalGaps.length; if (crit) W.push(`${crit} critical control gap${crit > 1 ? 's' : ''} (high-weight controls at or below Started)`);
  const gaps = ctl.filter((c) => c.status === 'Gap' || c.status === 'Partial');
  if (gaps.length) W.push(`${gaps.length} control${gaps.length > 1 ? 's' : ''} with skipped checks: ${gaps.slice(0, 3).map((c) => c.control.id).join(', ')}`);
  const unk = (r.unknownControls?.length || 0) + (r.unknownProfile?.length || 0);
  if (unk) W.push(`${unk} answer${unk > 1 ? 's' : ''} "Not known", scored as worst case`);
  const ds = s.datasets || []; const noLin = ds.filter((d) => !d.lineage).length;
  if (noLin) W.push(`${noLin} of ${ds.length} dataset${ds.length > 1 ? 's' : ''} without documented lineage`);
  const worstC = COMPASS_IDS.filter((k) => comp[k] != null).sort((a, b) => comp[a] - comp[b])[0];
  if (worstC && comp[worstC] < 50) W.push(`Weakest Compass direction: ${COMPASS[worstC].name} (${comp[worstC]})`);

  // Opportunities
  const w = whatIf(s);
  if (w.started && w.afterStarted < w.now) O.push(`Moving ${w.started} "Started" control${w.started > 1 ? 's' : ''} to "In place" cuts the score from ${w.now} to ${w.afterStarted}`);
  if (w.unknown && w.afterUnknown < w.now) O.push(`Confirming ${w.unknown} "Not known" control${w.unknown > 1 ? 's' : ''} could cut the score to ${w.afterUnknown}`);
  const quick = (s.actions || []).filter((x) => x.status === 'In progress').length;
  if (quick) O.push(`${quick} action${quick > 1 ? 's are' : ' is'} already in progress: closing ${quick > 1 ? 'them' : 'it'} raises readiness`);
  const notCat = ds.filter((d) => !d.catalogued).length;
  if (notCat) O.push(`Register ${notCat} dataset${notCat > 1 ? 's' : ''} in the data catalog to strengthen Data governance`);
  if (s.stage <= 6) O.push(`Go-live approval (stage 6) would certify the AI card for production`);
  if (!s.card?.limitations) O.push('Document known limitations on the AI card for users and auditors');

  // Threats
  if (r.legal?.tier && r.legal.tier !== 'minimal') T.push(`Legal floor ${TIERS[r.legal.tier].label}: ${r.legal.reason}`);
  deadlinesFor(s).slice(0, 2).forEach((d) => T.push(`${d.title}: ${d.days < 0 ? `${-d.days} days ago` : `in ${d.days} days`} (${d.date})`));
  pr.filter((p) => p.risk >= 67).slice(0, 2).forEach((p) => T.push(`High inherent risk on ${PRINCIPLES[p.k].name} (${p.risk}/100)`));
  const overdue = (s.actions || []).filter((x) => x.status !== 'Done' && x.due < today()).length;
  if (overdue) T.push(`${overdue} action${overdue > 1 ? 's' : ''} past due`);
  if (s.nextReview && s.nextReview < today()) T.push(`Periodic review overdue since ${s.nextReview}`);
  if ((s.events || []).some((e) => e.kind === 'incident')) T.push('AI incident on record: regulators and auditors will ask for the closure evidence');
  const vendor = ['vendor', 'foundation'].includes(s.assessment.profile.sourcing);
  if (vendor) T.push('Depends on a third-party model: vendor changes can alter behaviour without notice');

  const fill = (xs, msg) => (xs.length ? xs : [msg]);
  return {
    strengths: fill(S, 'No area is yet strong enough to count as a strength').slice(0, 5),
    weaknesses: fill(W, 'No material weakness found').slice(0, 5),
    opportunities: fill(O, 'No quick wins identified').slice(0, 5),
    threats: fill(T, 'No external threat identified').slice(0, 5),
  };
}

export function keyMessages(s, rules = {}) {
  const r = s.assessment.results; const sw = swot(s, rules);
  const open = (s.actions || []).filter((x) => x.status !== 'Done');
  return [
    `${TIERS[r.tier].label} risk. Score ${r.inherent}/100 before controls, ${r.residual}/100 after (${r.readiness}% of controls in place).`,
    `Stage ${s.stage} of 10: ${STAGES[s.stage - 1].name}.`,
    `Biggest strength: ${sw.strengths[0]}.`,
    `Biggest weakness: ${sw.weaknesses[0]}.`,
    open.length ? `${open.length} open actions, ${open.filter((x) => x.priority === 'High').length} high priority.` : 'No open actions.',
  ];
}
