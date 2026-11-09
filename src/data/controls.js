// Control library. Every lifecycle checklist item maps to one control, so a ticked item is evidence that the
// control operates, and a skipped item is a control gap with a recorded reason.
//
// mandatory: the item can never be skipped. highRisk: also mandatory when the product is High risk or above.
// compass: the Responsible AI Compass direction the control serves (Fractal, "Responsible AI by Design:
// Navigating with a Compass"): four directions plus four cross-cutting principles.
import { STAGES } from './lifecycle.js';

export const COMPASS = {
  fairness: { name: 'Fairness', dir: 'N', kind: 'direction', text: 'Equitable outcomes across groups' },
  transparency: { name: 'Transparency', dir: 'E', kind: 'direction', text: 'Explainable and traceable decisions' },
  accountability: { name: 'Accountability', dir: 'S', kind: 'direction', text: 'Someone answers for every decision' },
  security: { name: 'Security', dir: 'W', kind: 'direction', text: 'Protected against harm and misuse' },
  inclusiveness: { name: 'Inclusiveness', dir: 'NE', kind: 'cross', text: 'Diverse groups represented and understood' },
  oversight: { name: 'Human oversight', dir: 'SE', kind: 'cross', text: 'People can interpret and intervene' },
  datagov: { name: 'Data governance', dir: 'SW', kind: 'cross', text: 'Owned, auditable, protected data' },
  sustainability: { name: 'Sustainability', dir: 'NW', kind: 'cross', text: 'Fair to future stakeholders and the planet' },
};
export const COMPASS_IDS = Object.keys(COMPASS);
// Compass phases and the lifecycle stages that evidence them.
export const COMPASS_PHASES = [
  { id: 'design', name: 'Design', stages: [1, 2] },
  { id: 'build', name: 'Build', stages: [3, 4] },
  { id: 'test', name: 'Test', stages: [5] },
  { id: 'deploy', name: 'Deploy and monitor', stages: [6, 7, 8, 9] },
];

// Order matters: the first control whose pattern matches a checklist item owns it.
export const CONTROLS = [
  { id: 'TST-02', name: 'Fairness and subgroup testing', family: 'Testing', type: 'Detective', compass: 'fairness', mandatory: false, highRisk: true, match: /relevant groups|worst-performing|subgroup gaps/i },
  { id: 'HOV-01', name: 'Human oversight and contestability', family: 'Human oversight', type: 'Preventive', compass: 'oversight', mandatory: false, highRisk: true, match: /human|reviewers? (have|can)|reject, override|override|escalat|intervene|appeal|redress|staffed/i },
  { id: 'SEC-01', name: 'Security and adversarial resilience', family: 'Security', type: 'Preventive', compass: 'security', mandatory: true, match: /poison|tamper|injection|leakage|bypass|credentials|apis|security signals/i },
  { id: 'OPS-01', name: 'Rollback, isolation and kill switch', family: 'Operations', type: 'Corrective', compass: 'security', mandatory: true, match: /rollback|kill switch|kill-switch|isolat|disabled quickly|fail-safe|safety-critical|recoverable/i },
  { id: 'INC-01', name: 'Incident response and notification', family: 'Incident management', type: 'Corrective', compass: 'accountability', mandatory: true, match: /incident|notification|root cause|evidence is preserved|24\/7|reporting route|corrected or reversed|redress/i },
  { id: 'APR-01', name: 'Approvals and residual-risk acceptance', family: 'Governance', type: 'Preventive', compass: 'accountability', mandatory: true, match: /approv|sign-off|authori[sz]e|accepted by|control functions|within appetite|formally accepted/i },
  { id: 'AIG-01', name: 'Use-case register and ownership', family: 'Governance', type: 'Preventive', compass: 'accountability', mandatory: true, match: /owner|assigned|inventory|ownership/i },
  { id: 'AIG-02', name: 'Risk classification', family: 'Risk management', type: 'Preventive', compass: 'accountability', mandatory: true, match: /risk classification|risks are scored|risk tier|methodology|risk register/i },
  { id: 'DAT-01', name: 'Data rights and provenance', family: 'Data governance', type: 'Preventive', compass: 'datagov', mandatory: true, match: /licen[cs]e|consent|permitted-use|notices, consent|contractual/i },
  { id: 'DAT-03', name: 'Data protection, retention and access', family: 'Data protection', type: 'Preventive', compass: 'security', mandatory: true, match: /sensitive values|retention|deletion|least privilege|separation of duties|logs are retained|retained or deleted/i },
  { id: 'DAT-02', name: 'Data quality and representativeness', family: 'Data quality', type: 'Detective', compass: 'fairness', mandatory: false, highRisk: true, match: /quality|representative|adequate|labels|annotation|datasets are independent|evaluation data/i },
  { id: 'DAT-04', name: 'Versioning and lineage', family: 'Data governance', type: 'Detective', compass: 'datagov', mandatory: false, match: /version|reproduc|lineage|previous configuration/i },
  { id: 'AIG-03', name: 'Harm and misuse analysis', family: 'Risk management', type: 'Preventive', compass: 'security', mandatory: false, highRisk: true, match: /harm|misuse|abuse|failure/i },
  { id: 'AIG-04', name: 'Purpose, stakeholders and alternatives', family: 'Governance', type: 'Preventive', compass: 'inclusiveness', mandatory: false, match: /problem and intended|alternatives|intended users|affected|vulnerable|benefits|users and downstream|intended use/i },
  { id: 'TST-01', name: 'Testing, validation and acceptance', family: 'Testing', type: 'Detective', compass: 'security', mandatory: false, highRisk: true, match: /test|acceptance criteria|robustness|edge cases|false positive|threshold|validation|regression|explanations are accurate/i },
  { id: 'MOD-01', name: 'Model design and stated limits', family: 'Model risk', type: 'Preventive', compass: 'transparency', mandatory: false, match: /model choice|operating conditions|limitations|out-of-scope|dependencies|vendor|third-party/i },
  { id: 'TRN-01', name: 'Transparency and user disclosure', family: 'Transparency', type: 'Preventive', compass: 'transparency', mandatory: false, highRisk: true, match: /disclosure|notices|instructions|explanation|informed|communication/i },
  { id: 'ACC-01', name: 'Accessibility and inclusive design', family: 'Inclusion', type: 'Preventive', compass: 'inclusiveness', mandatory: false, match: /accessib|inclusive/i },
  { id: 'MON-01', name: 'Production monitoring', family: 'Monitoring', type: 'Detective', compass: 'fairness', mandatory: false, highRisk: true, match: /monitor|drift|dashboard|alert|lagging|metrics have|complaints|trained/i },
  { id: 'DOC-01', name: 'Documentation and record keeping', family: 'Documentation', type: 'Detective', compass: 'transparency', mandatory: false, match: /document|card|record|refreshed|updated|lessons|captured|current|complete/i },
  { id: 'EXT-01', name: 'Retirement and vendor exit', family: 'Operations', type: 'Corrective', compass: 'datagov', mandatory: false, match: /retire|vendor exit|decommission|open incidents, complaints|resolved or transferred/i },
  { id: 'SUS-01', name: 'Sustainability and workforce impact', family: 'Sustainability', type: 'Preventive', compass: 'sustainability', mandatory: false, match: /sustainab|environment|energy|footprint/i },
  { id: 'GOV-00', name: 'Governance record', family: 'Governance', type: 'Detective', compass: 'accountability', mandatory: false, match: /.*/ },
];
export const controlById = (id) => CONTROLS.find((c) => c.id === id);
// Items the patterns would place in the wrong family.
const PINNED = {
  'Residual risk is within appetite or escalated.': 'APR-01',
  'Risks are scored using the approved methodology.': 'AIG-02',
  'Complaints, appeals and overrides are categorized and analyzed.': 'MON-01',
  'Drift, harmful outputs and security signals trigger action.': 'MON-01',
  'Performance and fairness metrics have thresholds and owners.': 'MON-01',
  'A single reporting route and 24/7 escalation path exist where needed.': 'INC-01',
  'Affected parties receive appropriate communication and redress.': 'INC-01',
  'Root cause distinguishes model, data, design, human, process and vendor factors.': 'INC-01',
  'Open incidents, complaints and appeals are resolved or transferred.': 'EXT-01',
  'Credentials, APIs and automations are disabled.': 'EXT-01',
  'Vendor exit and deletion evidence are obtained.': 'EXT-01',
  'Users and downstream systems are informed.': 'EXT-01',
  'Every data source has an accountable owner and permitted-use basis.': 'DAT-01',
  'Users receive appropriate disclosure, instructions and limitations.': 'TRN-01',
  'Explanations are accurate, useful and appropriate to the audience.': 'TRN-01',
  'Model choice and alternatives are justified.': 'MOD-01',
  'High-risk systems receive independent periodic review.': 'TST-01',
  'Continued use is suspended when risk exceeds tolerance.': 'OPS-01',
  'Model, data, prompt, retrieval, tool, geography, language, user and automation changes are considered.': 'AIG-02',
};
export const controlFor = (item) => (PINNED[item] && controlById(PINNED[item])) || CONTROLS.find((c) => c.match.test(item));

// Why a check can be skipped. A reason category plus a written explanation; "Planned" needs a target date.
export const SKIP_REASONS = [
  { id: 'na', label: 'Does not apply to this product', action: false },
  { id: 'covered', label: 'Covered by another control or process', action: false },
  { id: 'planned', label: 'Planned: will be done by a date', action: true, needsDate: true },
  { id: 'accepted', label: 'Risk accepted by the business owner', action: true },
];
export const MIN_REASON = 20;

// A reason is valid when it explains something: long enough, several words, not filler.
export function validReason(text) {
  const t = String(text || '').trim();
  if (t.length < MIN_REASON) return `Explain in at least ${MIN_REASON} characters.`;
  const words = t.split(/\s+/).filter((w) => /[a-z]{2,}/i.test(w));
  if (words.length < 4) return 'Use at least four words.';
  if (/^(.)\1+$/.test(t.replace(/\s/g, '')) || /^(n\/?a|na|none|nil|skip|test|tbd|todo|later|ok)\b[\s.!]*$/i.test(t)) return 'Give a real reason.';
  if (new Set(t.toLowerCase().replace(/[^a-z]/g, '')).size < 6) return 'Give a real reason.';
  return '';
}

// Whether a checklist item must be ticked. Administrator rules win; then the control's own rule.
export function isMandatory(item, tier, rules = {}) {
  if (rules[item] === 'mandatory') return true;
  if (rules[item] === 'optional') return false;
  const c = controlFor(item);
  return !!(c.mandatory || (c.highRisk && (tier === 'high' || tier === 'unacceptable')));
}

// State of one checklist item on a stage record.
export const itemState = (rec, item) => (rec?.checklist?.[item] ? 'done' : rec?.skipped?.[item] ? 'skipped' : 'open');

// Control status for one product, from the checklist items it owns across every stage reached so far.
export function controlStatus(sys, rules = {}) {
  const tier = sys.assessment?.results?.tier;
  const out = new Map();
  for (const st of STAGES) {
    const rec = sys.stages?.[st.n];
    if (!rec) continue;
    for (const item of st.checklist) {
      const c = controlFor(item);
      const row = out.get(c.id) || { control: c, done: 0, skipped: 0, open: 0, items: [], mandatory: false };
      const s = itemState(rec, item);
      row[s] += 1;
      row.items.push({ stage: st.n, item, state: s, skip: rec.skipped?.[item] || null });
      row.mandatory = row.mandatory || isMandatory(item, tier, rules);
      out.set(c.id, row);
    }
  }
  return [...out.values()].map((r) => ({
    ...r,
    status: r.skipped && !r.done ? 'Gap' : r.skipped ? 'Partial' : r.open ? 'In progress' : 'Operating',
  })).sort((a, b) => CONTROLS.indexOf(a.control) - CONTROLS.indexOf(b.control));
}

// Compass score 0-100 per direction: share of the product's checklist items for that direction that are done,
// blended with the assessment readiness of the matching principles. null when nothing evidences it yet.
export function compassScores(sys) {
  const r = sys.assessment?.results;
  const fromChecks = {}; const byPhase = {};
  for (const ph of COMPASS_PHASES) byPhase[ph.id] = {};
  for (const st of STAGES) {
    const rec = sys.stages?.[st.n];
    const ph = COMPASS_PHASES.find((p) => p.stages.includes(st.n));
    for (const item of st.checklist) {
      const k = controlFor(item).compass;
      if (!rec) continue;
      const v = itemState(rec, item) === 'done' ? 1 : 0;
      (fromChecks[k] ||= []).push(v);
      if (ph) (byPhase[ph.id][k] ||= []).push(v);
    }
  }
  const pr = (id) => r?.principles?.[id]?.readiness;
  const fromAssessment = {
    fairness: [pr('fairness')], transparency: [pr('transparency')], accountability: [pr('accountability')],
    security: [pr('privacy'), pr('robustness')], inclusiveness: [pr('social'), pr('fairness')],
    oversight: [pr('accountability'), pr('transparency')], datagov: [r?.dg?.score], sustainability: [pr('social')],
  };
  const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const scores = {};
  for (const k of COMPASS_IDS) {
    const checks = fromChecks[k]?.length ? Math.round((fromChecks[k].reduce((a, b) => a + b, 0) / fromChecks[k].length) * 100) : null;
    scores[k] = mean([checks, mean(fromAssessment[k])]);
  }
  const phases = {};
  for (const ph of COMPASS_PHASES) {
    phases[ph.id] = Object.fromEntries(COMPASS_IDS.map((k) => {
      const xs = byPhase[ph.id][k];
      return [k, xs?.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) : null];
    }));
  }
  return { scores, phases };
}

// How far a stage is: mandatory checks, optional checks (ticked or skipped with a reason) and evidence.
// pct counts every item equally, the same way the progress ring does; ready means it can be submitted.
export function stageCompletion(st, rec, tier, rules) {
  const list = st?.checklist || []; const ev = st?.evidence || [];
  const mand = list.filter((i) => isMandatory(i, tier, rules));
  const opt = list.filter((i) => !isMandatory(i, tier, rules));
  const out = {
    mandatory: { done: mand.filter((i) => itemState(rec, i) === 'done').length, total: mand.length },
    optional: { done: opt.filter((i) => itemState(rec, i) === 'done').length, skipped: opt.filter((i) => itemState(rec, i) === 'skipped').length, total: opt.length },
    evidence: { done: ev.filter((i) => rec?.evidence?.[i]).length, total: ev.length },
  };
  const total = list.length + ev.length;
  const done = out.mandatory.done + out.optional.done + out.optional.skipped + out.evidence.done;
  return { ...out, done, total, pct: total ? Math.round((done / total) * 100) : 100 };
}
// The same percentage as the completion scale, so the rail and the scale always agree.
export const stagePct = (st, rec, tier, rules) => stageCompletion(st, rec, tier, rules).pct;
