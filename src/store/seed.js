// Demo portfolio across three client organisations, spread over the ten lifecycle stages, built with the same engine a real submission uses.
import { emptyProfile, buildQuestionnaire, scoreAssessment, buildActions, profileFlags } from '../engine/engine.js';
import { requiredApprovals, STAGES } from '../data/lifecycle.js';
import { TIERS, DEMO_CLIENTS } from '../data/frameworks.js';

function rng(seedText) {
  let h = 2166136261;
  for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

const ds = (name, sourceSystem, role, classification, personal, owner, steward, catalogued, lineage, qualityChecked) =>
  ({ id: `${name}-${sourceSystem}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, sourceSystem, role, classification, personal, owner, steward, catalogued, lineage, qualityChecked });

// Profile answers: option index per question id (see PROFILE_QUESTIONS).
const A = (impact, scale, footprint, misuse, harm, people, proxies, reversibility, inputs, automation, explain, contest) =>
  ({ impact, scale, footprint, misuse, harm, people, proxies, reversibility, inputs, automation, explain, contest });

const DEMOS = [
  {
    client: 'northwind', stage: 4, st: 'open',
    p: { name: 'Motor claims triage model', bu: 'Claims', owner: 'Priya Nair', domain: 'insurance', systemType: 'ml', sourcing: 'build', geos: ['GB', 'IN'], data: ['contact', 'financial'],
      description: 'Routes new motor claims to fast-track settlement or to an investigator, using claim details, policy history and repair estimates.',
      answers: A(2, 1, 1, 0, 1, 2, 1, 0, 1, 1, 1, 1), annex: 'none', transparency: [] },
    fws: ['GDPR', 'DPDP'], bias: 0.62, evid: 0.85,
    datasets: [ds('Claims FNOL records', 'Guidewire ClaimCenter', 'Training', 'Confidential', true, 'Head of Claims', 'R. Das', true, true, true),
      ds('Policy master', 'Policy admin system', 'Inference input', 'Confidential', true, 'Head of Underwriting', 'M. Iyer', true, true, false),
      ds('Repair estimates', 'Garage partner API', 'Inference input', 'Internal', false, 'Supply chain lead', '', false, false, false)],
    outputs: ['Recommendation to a staff member', 'Internal dashboard or report'],
    card: {
      summary: 'A classification model that scores each new motor claim and recommends fast-track settlement or referral to an investigator.',
      intendedUse: 'Claims handlers in the motor claims team use the score at first notification of loss to decide the handling route. The handler makes the final decision.',
      outOfScope: 'Not for refusing claims, pricing policies, or any decision without a handler. Not for commercial, marine or home claims.',
      affected: 'Claims handlers (users) and motor policyholders who make a claim (affected, never see the model).',
      oversight: 'Every recommendation is reviewed by a handler, who can override it with a reason. Overrides are sampled weekly by the claims quality lead.',
      limitations: 'Trained on 2022 to 2025 UK claims. Lower accuracy on claims with incomplete repair estimates and on vehicles older than 15 years.',
      ethics: 'Postcode is excluded as a feature to avoid proxy discrimination. Fast-track rates are monitored by age band and region.',
      modelName: 'Gradient boosted trees (LightGBM)', modelVersion: '1.4.0', modelOwner: 'Claims analytics lead',
      metrics: [{ name: 'AUC', value: '0.86', at: '2026-09-30' }, { name: 'Fast-track precision', value: '93%', at: '2026-09-30' }, { name: 'Override rate', value: '7.5%', at: '2026-10-31' }],
      tags: ['claims', 'triage', 'motor', 'fnol'],
    },
  },
  {
    client: 'northwind', stage: 2, st: 'submitted',
    p: { name: 'Life and health premium pricing', bu: 'Pricing', owner: 'Arjun Sen', domain: 'insurance', systemType: 'ml', sourcing: 'build', geos: ['DE', 'FR', 'IN'], data: ['contact', 'financial', 'health'],
      description: 'Gradient boosted model that sets individual premiums for term life and health cover using medical disclosures and claims history.',
      answers: A(3, 1, 0, 0, 2, 2, 2, 0, 1, 1, 1, 2), annex: 'essential', profiling: 'yes', transparency: [] },
    fws: ['EU_AI_ACT', 'GDPR', 'DPDP'], bias: 0.45, evid: 0.6,
    datasets: [ds('Medical disclosures', 'Underwriting portal', 'Training', 'Restricted', true, 'Chief Underwriter', 'S. Roy', true, false, true),
      ds('Claims history', 'Claims data warehouse', 'Training', 'Confidential', true, 'Head of Claims', 'R. Das', true, true, true)],
    outputs: ['Automated decision sent to a person', 'Downstream system or API'],
  },
  {
    client: 'northwind', stage: 6, st: 'submitted',
    p: { name: 'Fraud detection scoring', bu: 'Counter Fraud', owner: 'Kavya Reddy', domain: 'insurance', systemType: 'anomaly', sourcing: 'build', geos: ['IN'], data: ['contact', 'financial', 'behavioural'],
      description: 'Isolation forest model that flags suspicious claims for the special investigations unit, using claim patterns and device data.',
      answers: A(2, 1, 0, 1, 1, 2, 1, 1, 2, 0, 1, 1), annex: 'none', transparency: [] },
    fws: ['DPDP'], bias: 0.6, evid: 0.8,
    datasets: [ds('Claims FNOL records', 'Guidewire ClaimCenter', 'Training', 'Confidential', true, 'Head of Claims', 'R. Das', true, true, true),
      ds('Device fingerprints', 'Mobile app telemetry', 'Inference input', 'Restricted', true, 'Digital lead', '', false, false, false)],
    outputs: ['Recommendation to a staff member'],
  },
  {
    client: 'meridian', stage: 3, st: 'returned', returnNote: 'Attach the source and licence register for the vendor CV data, and confirm the training and test sets are independent.',
    p: { name: 'CV screening assistant', bu: 'HR', owner: 'Rahul Verma', domain: 'hr', systemType: 'ml', sourcing: 'vendor', geos: ['DE', 'FR', 'IN'], data: ['personal', 'employee'],
      description: 'Vendor tool that ranks CVs against job requirements and produces a shortlist for recruiters.',
      answers: A(3, 1, 1, 1, 1, 1, 2, 1, 1, 0, 2, 2), annex: 'employment', profiling: 'yes', transparency: [] },
    fws: ['EU_AI_ACT', 'GDPR', 'DPDP'], bias: 0.55, evid: 0.55,
    datasets: [ds('Applicant CVs', 'Workday Recruiting', 'Inference input', 'Confidential', true, 'Head of Talent', '', true, false, false),
      ds('Job requisitions', 'Workday Recruiting', 'Reference data', 'Internal', false, 'Head of Talent', 'N. Ghosh', true, true, true)],
    outputs: ['Recommendation to a staff member'],
  },
  {
    client: 'meridian', stage: 7, st: 'open', reviewOffset: 120,
    p: { name: 'Customer support assistant', bu: 'Customer Operations', owner: 'Sneha Kapoor', domain: 'service', systemType: 'rag', sourcing: 'foundation', geos: ['IE', 'GB'], data: ['contact'],
      description: 'LLM chatbot with retrieval (RAG) over product terms and FAQs that answers customer questions on the website and hands over to an agent.',
      answers: A(1, 2, 1, 1, 1, 2, 0, 0, 1, 1, 2, 1), annex: 'none', transparency: ['chat', 'synthetic'] },
    fws: ['EU_AI_ACT', 'GDPR'], bias: 0.78, evid: 0.9,
    datasets: [ds('Product terms library', 'SharePoint', 'Knowledge base', 'Internal', false, 'Product owner', 'K. Bose', true, true, true),
      ds('Chat transcripts', 'Contact centre platform', 'Inference input', 'Confidential', true, 'Head of Service', 'A. Sen', true, false, false)],
    outputs: ['Content or answers shown to customers'],
  },
  {
    client: 'meridian', stage: 1, st: 'open',
    p: { name: 'Interview emotion analyser', bu: 'HR', owner: 'Rahul Verma', domain: 'hr', systemType: 'vision', sourcing: 'vendor', geos: ['NL'], data: ['employee', 'biometric'],
      description: 'Vendor video tool that scores candidate emotions and engagement during recorded interviews.',
      answers: A(3, 1, 1, 1, 1, 1, 2, 1, 1, 1, 2, 2), annex: 'biometrics',
      prohibited: ['Emotion recognition in the workplace or in education (except medical or safety reasons)'], transparency: ['emotion'] },
    fws: ['EU_AI_ACT', 'GDPR'], bias: 0.3, evid: 0.3,
    datasets: [ds('Interview recordings', 'Vendor video platform', 'Inference input', 'Restricted', true, 'Head of Talent', '', false, false, false)],
    outputs: ['Recommendation to a staff member'],
  },
  {
    client: 'lotus', stage: 9, st: 'open', reviewOffset: -20, incident: 'Generated copy quoted a discontinued offer price in one campaign.',
    p: { name: 'Marketing email copy generator', bu: 'Marketing', owner: 'Isha Banerjee', domain: 'marketing', systemType: 'genai', sourcing: 'foundation', geos: ['NL'], data: ['none'],
      description: 'Drafts campaign email copy for marketers to edit before sending.',
      answers: A(0, 1, 1, 1, 0, 0, 0, 0, 1, 0, 2, 0), annex: 'none', transparency: ['synthetic'] },
    fws: ['EU_AI_ACT'], bias: 0.82, evid: 0.9,
    datasets: [ds('Brand style guide', 'Brand portal', 'Knowledge base', 'Public', false, 'Brand lead', 'T. Paul', true, true, true)],
    outputs: ['Content or answers shown to customers'],
  },
  {
    client: 'lotus', stage: 1, st: 'submitted',
    p: { name: 'Store demand forecasting', bu: 'Supply chain', owner: 'Dev Malhotra', domain: 'operations', systemType: 'forecast', sourcing: 'build', geos: ['IN'], data: ['behavioural'],
      description: 'Forecasts weekly demand per store and product using sales history, promotions and loyalty-card purchase data.',
      answers: A(1, 2, 1, 0, 1, 2, 1, 0, 1, 1, 1, 0), annex: 'none', transparency: [] },
    fws: ['DPDP'], bias: 0.55, evid: 0.5,
    datasets: [ds('Store sales history', 'SAP S/4HANA', 'Training', 'Internal', false, 'Head of Supply Chain', 'P. Jain', true, true, true),
      ds('Loyalty purchases', 'Loyalty platform', 'Training', 'Confidential', true, 'CRM lead', '', false, false, false)],
    outputs: ['Internal dashboard or report', 'Downstream system or API'],
  },
];

export const DEMO_USERS = [
  { id: 'u1', name: 'Priya Nair', email: 'priya.nair@northwind.example', role: 'client', clientId: 'northwind' },
  { id: 'u2', name: 'Arjun Mehta', email: 'arjun.mehta@meridian.example', role: 'client', clientId: 'meridian' },
  { id: 'u3', name: 'Isha Banerjee', email: 'isha.banerjee@lotus.example', role: 'client', clientId: 'lotus' },
  { id: 'u4', name: 'Ananya Rao', email: 'ananya.rao@governai.example', role: 'assessor' },
  { id: 'u5', name: 'Vikram Shah', email: 'vikram.shah@governai.example', role: 'lead' },
  { id: 'u6', name: 'Neha Gupta', email: 'neha.gupta@governai.example', role: 'admin' },
];

export function answerSim(questions, flags, bias, seed) {
  const r = rng(seed); const answers = {};
  for (const q of questions) {
    if (q.na && !flags.personal && /personal data|processor/.test(q.na)) { answers[q.id] = 'na'; continue; }
    answers[q.id] = Math.max(0, Math.min(3, Math.round(bias * 3 + (r() - 0.5) * 2.2)));
  }
  return answers;
}

const file = (item) => `${item.replace(/[^A-Za-z0-9]+/g, '-').replace(/-$/, '')}.pdf`;
const done = (n, at, tier) => {
  const st = STAGES[n - 1];
  return {
    status: 'approved', note: '', submittedAt: at, approvedAt: at,
    checklist: Object.fromEntries(st.checklist.map((i) => [i, true])),
    evidence: Object.fromEntries(st.evidence.slice(0, Math.max(2, st.evidence.length - 1)).map((i, k) => [i, k % 2 ? { ref: `SharePoint / AI governance / ${i}`, file: '' } : { ref: '', file: file(i) }])),
    approvals: Object.fromEntries(requiredApprovals(n, tier).map((r) => [r, { outcome: 'Approved', comment: '', at }])),
    log: [{ at, who: 'client', outcome: 'Submitted', comment: '' }, ...requiredApprovals(n, tier).map((r) => ({ at, who: r, as: r, outcome: 'Approved', comment: '' }))],
  };
};
const current = (n, mode, tier, at, note) => {
  const st = STAGES[n - 1];
  const all = mode !== 'open';
  return {
    status: mode, note: mode === 'submitted' ? 'All items confirmed; evidence attached.' : '', submittedAt: all ? at : undefined,
    returnNote: mode === 'returned' ? note : '',
    checklist: Object.fromEntries(st.checklist.slice(0, all ? st.checklist.length : Math.ceil(st.checklist.length / 2)).map((i) => [i, true])),
    evidence: Object.fromEntries(st.evidence.slice(0, all ? 3 : 1).map((i) => [i, { ref: '', file: file(i) }])),
    approvals: mode === 'returned' ? { assessor: { outcome: 'Returned', comment: note, at } } : {},
    log: all ? [{ at, who: 'client', outcome: 'Submitted', comment: mode === 'submitted' ? 'All items confirmed; evidence attached.' : '' },
      ...(mode === 'returned' ? [{ at, who: 'assessor', as: 'assessor', outcome: 'Returned', comment: note, internal: 'Second time the data lineage has been missing; flag to the lead if it happens again.' }] : [])] : [],
  };
};

export function buildSeed() {
  const systems = []; const audit = []; const notes = [];
  const today = new Date();
  DEMOS.forEach((d, i) => {
    const profile = { ...emptyProfile(), ...d.p };
    const { fixed, adaptive } = buildQuestionnaire(profile, d.fws);
    const questions = [...fixed, ...adaptive];
    const answers = answerSim(questions, profileFlags(profile), d.bias, profile.name);
    if (i === 0) { const q = questions.find((x) => x.kind !== 'core' && answers[x.id] !== 'na'); if (q) answers[q.id] = 'unknown'; }   // demo of a "Not known" answer
    const results = scoreAssessment(profile, d.fws, questions, answers);
    const tier = results.tier;
    const created = new Date(today.getTime() - (200 - i * 18) * 86400000);
    const at = (days) => new Date(created.getTime() + days * 86400000).toISOString();
    const blocked = tier === 'unacceptable';
    const stage = blocked ? 1 : d.stage;
    const stages = {};
    const path = stage <= 7 ? Array.from({ length: stage - 1 }, (_, k) => k + 1) : [1, 2, 3, 4, 5, 6];
    path.forEach((n, k) => { stages[n] = done(n, at(10 + k * 12), tier); });
    if (stage > 7) stages[7] = { ...done(7, at(90), tier) };
    stages[stage] = current(stage, blocked ? 'open' : d.st, tier, new Date(today.getTime() - (((i * 2) % 7) + 1) * 86400000).toISOString(), d.returnNote);
    const actions = buildActions(questions, answers, tier, new Date(today.getTime() - (40 - i * 3) * 86400000), profile);
    actions.forEach((a, k) => { if (k % 3 === 0 && stage > 3) a.status = 'Done'; else if (k % 4 === 1) a.status = 'In progress'; a.owner = profile.owner; });
    const id = `sys-${i + 1}`;
    // Demo of an optional check skipped with a reason on the first product's open stage.
    if (i === 0 && stages[stage]?.status === 'open') {
      const item = STAGES[stage - 1].checklist.find((x) => !stages[stage].checklist[x] && /Accessibility/.test(x));
      if (item) stages[stage].skipped = { [item]: { category: 'planned', reason: 'Claims handlers use the desktop tool only; the accessibility audit is booked with the UX team for January.', due: new Date(today.getTime() + 60 * 86400000).toISOString().slice(0, 10), at: at(98), control: 'ACC-01' } };
      if (item) actions.push({ id: `act-demo-skip`, qid: `check:${stage}:ACC-01`, source: 'checklist', stage, item, control: 'ACC-01', topic: 'Accessibility and inclusive design', action: `Complete: ${item.replace(/\.$/, '')}. Reason given: accessibility audit booked with the UX team.`, principle: 'accountability', refs: `Control ACC-01, stage ${stage}`, priority: 'Medium', due: stages[stage].skipped[item].due, status: 'Open', owner: profile.owner });
    }
    // internal notes move out of the product into the team-only notes list
    for (const [n, rec] of Object.entries(stages)) {
      (rec.log || []).forEach((e, k) => {
        if (!e.internal) return;
        const noteId = `note-${id}-${n}-${k}`;
        notes.push({ id: noteId, productId: id, stage: +n, at: e.at, byRole: e.who, byName: 'Ananya Rao', text: e.internal });
        delete e.internal; e.noteId = noteId;
      });
    }
    systems.push({
      id, code: `AI-2026-${String(i + 1).padStart(3, '0')}`, clientId: d.client,
      name: profile.name, bu: profile.bu, owner: profile.owner, description: profile.description,
      createdAt: created.toISOString(), createdBy: 'client', updatedAt: at(100),
      status: blocked ? 'Blocked' : stage >= 7 ? 'In production' : 'Active', stage, stages,
      nextReview: stage >= 7 ? new Date(today.getTime() + (d.reviewOffset ?? 120) * 86400000).toISOString().slice(0, 10) : null,
      events: d.incident ? [{ at: at(110), kind: 'incident', text: d.incident }] : [],
      assessment: { at: created.toISOString(), by: 'client', profile, frameworks: d.fws, questions, answers, results, questionSource: 'Rule-based tailoring' },
      history: [{ at: created.toISOString(), tier, inherent: results.inherent, residual: results.residual, readiness: results.readiness }],
      datasets: d.datasets, outputs: d.outputs, actions, draft: null, ...(d.card ? { card: { ...d.card, version: 1, updatedAt: at(99), versions: [{ version: 1, at: at(99), by: 'client', byName: profile.owner, changed: Object.keys(d.card) }] } } : {}),
    });
    audit.push({ at: created.toISOString(), actor: 'client', org: d.client, action: 'Registered', target: id, detail: `${profile.name}: ${TIERS[tier].label} risk, score ${results.residual}` });
    for (const n of Object.keys(stages)) if (stages[n].status === 'approved') audit.push({ at: stages[n].approvedAt, actor: 'assessor', action: 'Stage approved', target: id, detail: `Stage ${n}` });
  });
  audit.sort((a, b) => b.at.localeCompare(a.at));
  return { systems, audit, notes, clients: DEMO_CLIENTS.map((c) => ({ ...c })), users: DEMO_USERS.map((u) => ({ ...u })) };
}
