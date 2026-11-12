import { isEU } from './countries.js';

// Reference data: frameworks, use-case profile questions, EU AI Act screening lists.
// Summaries are indicative and need legal review. Dates checked November 2026.

export const FRAMEWORKS = {
  EU_AI_ACT: {
    id: 'EU_AI_ACT',
    name: 'EU AI Act',
    full: 'Regulation (EU) 2024/1689, as amended by the AI Omnibus, Regulation (EU) 2026/1744',
    color: '#3A46C9',
    blurb: 'Risk-based rules for AI placed on the EU market or whose output is used in the EU.',
    keyDates: [
      ['2 Feb 2025', 'Prohibited practices (Art. 5) and AI literacy (Art. 4) apply'],
      ['2 Aug 2026', 'Most transparency duties (Art. 50) apply'],
      ['2 Dec 2026', 'Machine-readable marking of AI-generated content (Art. 50(2)) and the new ban on AI that creates non-consensual intimate imagery or CSAM'],
      ['2 Dec 2027', 'High-risk obligations for Annex III systems apply (deferred from Aug 2026 by the Omnibus)'],
      ['2 Aug 2028', 'High-risk obligations for AI embedded in Annex I products apply'],
    ],
  },
  GDPR: {
    id: 'GDPR',
    name: 'GDPR',
    full: 'Regulation (EU) 2016/679 (and UK GDPR where relevant)',
    color: '#0E7490',
    blurb: 'Rules for processing personal data of people in the EU (UK GDPR mirrors most duties).',
    keyDates: [['In force', 'Applies to any processing of personal data in scope today']],
  },
  DPDP: {
    id: 'DPDP',
    name: 'DPDP Act',
    full: 'Digital Personal Data Protection Act, 2023 and DPDP Rules, 2025 (India)',
    color: '#9A5B13',
    blurb: "India's law on processing digital personal data, phased in by the DPDP Rules notified 13 Nov 2025.",
    keyDates: [
      ['13 Nov 2025', 'Rules 1, 2 and 17 to 21 in force; Data Protection Board set up'],
      ['13 Nov 2026', 'Consent Manager registration (Rule 4)'],
      ['13 May 2027', 'Substantive duties: notice, consent, security, 72-hour breach report, rights, children, SDF duties, transfers'],
    ],
  },
};

// Data governance is always assessed alongside the chosen laws.
// The Responsible AI baseline is always assessed, so every principle gets a readiness score.
export const RAI = {
  id: 'RAI',
  name: 'Responsible AI baseline',
  color: '#6B4FA0',
  blurb: 'One control per Responsible AI principle, plus tailored checks.',
};

export const DG = {
  id: 'DG',
  name: 'Data governance',
  color: '#2F6B4F',
  blurb: 'Catalog, lineage, quality, ownership, classification and retention of the data the system depends on.',
};

export const SELECTABLE_FRAMEWORKS = ['EU_AI_ACT', 'GDPR', 'DPDP'];
export const ALWAYS = ['RAI', 'DG'];          // always in scope, in this order after the chosen laws

export const PILLARS = {
  catalog: { name: 'Catalog & metadata', short: 'Catalog' },
  lineage: { name: 'Lineage & traceability', short: 'Lineage' },
  quality: { name: 'Data quality', short: 'Quality' },
  ownership: { name: 'Ownership & stewardship', short: 'Ownership' },
  classification: { name: 'Classification & access', short: 'Access' },
  retention: { name: 'Retention & lifecycle', short: 'Retention' },
};

export const DOMAINS = [
  { id: 'hr', label: 'HR & recruitment', subject: 'candidates and employees' },
  { id: 'credit', label: 'Banking & credit', subject: 'borrowers and customers' },
  { id: 'insurance', label: 'Insurance', subject: 'policyholders and claimants' },
  { id: 'health', label: 'Healthcare', subject: 'patients' },
  { id: 'education', label: 'Education', subject: 'students' },
  { id: 'service', label: 'Customer service', subject: 'customers' },
  { id: 'marketing', label: 'Marketing & sales', subject: 'customers and prospects' },
  { id: 'operations', label: 'Operations & internal productivity', subject: 'employees' },
  { id: 'public', label: 'Public sector', subject: 'citizens' },
  { id: 'other', label: 'Other', subject: 'the people affected' },
];

// AI product types. `family` drives which tailored questions apply; `rating` is the robustness risk (1-3).
export const SYSTEM_TYPES = [
  { id: 'rules', label: 'Rules engine or decision table', family: 'rules', rating: 1 },
  { id: 'scorecard', label: 'Statistical model or scorecard', family: 'rules', rating: 1 },
  { id: 'optimisation', label: 'Optimisation or scheduling engine', family: 'rules', rating: 1 },
  { id: 'ml', label: 'Predictive ML (classification or regression)', family: 'ml', rating: 2 },
  { id: 'forecast', label: 'Forecasting model', family: 'ml', rating: 2 },
  { id: 'recommender', label: 'Recommendation or personalisation engine', family: 'ml', rating: 2 },
  { id: 'anomaly', label: 'Anomaly or fraud detection', family: 'ml', rating: 2 },
  { id: 'nlp', label: 'Text classification or extraction (NLP)', family: 'ml', rating: 2 },
  { id: 'docai', label: 'Document AI (OCR and data capture)', family: 'vision', rating: 2 },
  { id: 'vision', label: 'Computer vision (image or video analysis)', family: 'vision', rating: 2 },
  { id: 'speech', label: 'Speech recognition or voice analytics', family: 'vision', rating: 2 },
  { id: 'biometric', label: 'Biometric identification or verification', family: 'vision', rating: 3 },
  { id: 'genai', label: 'Generative AI: text (LLM)', family: 'genai', rating: 3 },
  { id: 'genmedia', label: 'Generative AI: image, audio or video', family: 'genai', rating: 3 },
  { id: 'rag', label: 'Knowledge assistant (retrieval-augmented LLM)', family: 'genai', rating: 3 },
  { id: 'chatbot', label: 'Conversational chatbot or virtual assistant', family: 'genai', rating: 3 },
  { id: 'copilot', label: 'Coding or productivity copilot', family: 'genai', rating: 3 },
  { id: 'agent', label: 'AI agent that takes actions', family: 'agent', rating: 3 },
  { id: 'multiagent', label: 'Multi-agent system', family: 'agent', rating: 3 },
  { id: 'robotics', label: 'Robotics or physical AI', family: 'agent', rating: 3 },
  { id: 'foundation', label: 'Foundation model training or fine-tuning', family: 'genai', rating: 3 },
  { id: 'other', label: 'Other', family: 'other', rating: 2 },
];
export const familyOf = (id) => SYSTEM_TYPES.find((t) => t.id === id)?.family || id || '';
export const selectionLabel = (list, id, other = '') => (
  id === 'other' && other.trim()
    ? `Other: ${other.trim()}`
    : list.find((item) => item.id === id)?.label || id || '—'
);
export const systemTypeLabel = (id, other = '') => selectionLabel(SYSTEM_TYPES, id, other);

export const SOURCING = [
  { id: 'build', label: 'Built in-house', rating: 1 },
  { id: 'vendor', label: 'Bought from a vendor, with documentation and contract', rating: 2 },
  { id: 'foundation', label: 'Third-party foundation model or API we configure', rating: 3 },
  { id: 'other', label: 'Other', rating: 2 },
];



export const DATA_CATEGORIES = [
  { id: 'none', label: 'No personal data', rating: 1 },
  { id: 'personal', label: 'Personal data', rating: 2 },
  { id: 'contact', label: 'Identity and contact details', rating: 2 },
  { id: 'employee', label: 'Employee or HR records', rating: 2 },
  { id: 'financial', label: 'Financial data', rating: 2 },
  { id: 'behavioural', label: 'Behaviour, location or device data', rating: 2 },
  { id: 'health', label: 'Health data', rating: 3, special: true },
  { id: 'biometric', label: 'Biometric data', rating: 3, special: true },
  { id: 'special', label: 'Other special category (beliefs, ethnicity, genetics, orientation)', rating: 3, special: true },
  { id: 'children', label: "Children's data", rating: 3 },
];

// The six Responsible AI principles, used as the risk and readiness dimensions. Weights add up to 100.
export const PRINCIPLES = {
  social: {
    name: 'Social well-being and planet inclusive', short: 'Social & planet', weight: 14,
    tagline: 'Cost-benefit analyses for a net positive on humans, society and the planet',
    covers: 'Effects on people\'s lives and opportunities, jobs and skills, and energy use and carbon.',
  },
  privacy: {
    name: 'Privacy and safety', short: 'Privacy & safety', weight: 20, critical: true,
    tagline: 'Respect and protection from misuse',
    covers: 'Sensitive and personal data, security, and harm from misuse or failure.',
  },
  fairness: {
    name: 'Fairness and equity', short: 'Fairness', weight: 20, critical: true,
    tagline: 'Ensure equitable outcomes',
    covers: 'Who is affected, vulnerable groups, and attributes or proxies that can treat groups differently.',
  },
  robustness: {
    name: 'Robustness and stability', short: 'Robustness', weight: 16, critical: true,
    tagline: 'Reliable, repeatable outcomes',
    covers: 'Model uncertainty, consistency of outputs, changing input data and how easily errors are undone.',
  },
  accountability: {
    name: 'Accountability', short: 'Accountability', weight: 16, critical: true,
    tagline: 'Humans responsible; governance in place',
    covers: 'Human oversight of outputs, contestability, and dependence on vendors outside your control.',
  },
  transparency: {
    name: 'Transparency', short: 'Transparency', weight: 14,
    tagline: 'All deserve white-box decision choices',
    covers: 'Explainability of individual outputs and how much affected people need to understand them.',
  },
};
export const PRINCIPLE_IDS = Object.keys(PRINCIPLES);

// Profile questions: fixed and option based. Each option sets a 1 (low) to 3 (high) risk rating
// on one principle. `derived` items are worked out from step 1 (data, type of AI, sourcing).
export const PROFILE_QUESTIONS = [
  { id: 'impact', principle: 'social', q: 'What is the most serious effect an output can have on a person?', options: [
    { label: 'No effect on individuals', rating: 1 },
    { label: 'Minor convenience, easily ignored', rating: 1 },
    { label: 'Influences pricing, offers or the service a person gets', rating: 2 },
    { label: 'Decides access to a job, credit, insurance, healthcare, education or public services', rating: 3 } ] },
  { id: 'scale', principle: 'social', q: 'How many people could be affected in a year?', options: [
    { label: 'Fewer than 1,000', rating: 1 },
    { label: '1,000 to 100,000', rating: 2 },
    { label: 'More than 100,000, or several countries', rating: 3 } ] },
  { id: 'footprint', principle: 'social', q: 'What footprint does it have on jobs and the environment?', options: [
    { label: 'Small model, no change to anyone\'s role', rating: 1 },
    { label: 'Some tasks automated, or moderate compute', rating: 2 },
    { label: 'Roles displaced, or large-model training and heavy compute', rating: 3 } ] },
  { id: 'misuse', principle: 'privacy', q: 'How easily could the system be misused for manipulation, fraud, surveillance or harmful content?', options: [
    { label: 'Hardly at all', rating: 1 },
    { label: 'Possible with deliberate effort', rating: 2 },
    { label: 'Easily, or misuse is a known risk', rating: 3 } ] },
  { id: 'harm', principle: 'privacy', q: 'Could a failure cause physical, financial or psychological harm?', options: [
    { label: 'No realistic harm', rating: 1 },
    { label: 'Limited harm, such as inconvenience or a small cost', rating: 2 },
    { label: 'Serious harm to health, finances or wellbeing', rating: 3 } ] },
  { id: 'people', principle: 'fairness', q: 'Who is affected by the outputs?', options: [
    { label: 'Internal staff, on non-personal tasks', rating: 1 },
    { label: 'Employees, as the subject of the output', rating: 2 },
    { label: 'Customers or the general adult public', rating: 2 },
    { label: 'Vulnerable people: children, patients, people in financial difficulty, older people', rating: 3 } ] },
  { id: 'proxies', principle: 'fairness', q: 'Does it use attributes that could treat groups differently, such as age, gender, postcode or income?', options: [
    { label: 'No personal attributes are used', rating: 1 },
    { label: 'Only indirect attributes that could act as proxies', rating: 2 },
    { label: 'Protected attributes, or strong proxies such as postcode', rating: 3 } ] },
  { id: 'reversibility', principle: 'robustness', q: 'If an output is wrong, how easily can the harm be undone?', options: [
    { label: 'Easily, the same day', rating: 1 },
    { label: 'With effort, within weeks', rating: 2 },
    { label: 'With difficulty, or not at all', rating: 3 } ] },
  { id: 'inputs', principle: 'robustness', q: 'How stable is the data the system sees in use?', options: [
    { label: 'Stable and well understood', rating: 1 },
    { label: 'Changes with seasons, products or policies', rating: 2 },
    { label: 'Changes fast, or people may try to game it', rating: 3 } ] },
  { id: 'automation', principle: 'accountability', q: 'How much does a human check before an output takes effect?', options: [
    { label: 'Advisory only: a person makes every decision', rating: 1 },
    { label: 'Human in the loop: a person approves each output', rating: 2 },
    { label: 'Fully automated: outputs take effect without review', rating: 3 } ] },
  { id: 'explain', principle: 'transparency', q: 'Can the reasons behind an individual output be explained?', options: [
    { label: 'Yes, the model is interpretable (rules, scorecard, linear model)', rating: 1 },
    { label: 'Partly, through explanation tools on a complex model', rating: 2 },
    { label: 'No, it is a black box or a large language model', rating: 3 } ] },
  { id: 'contest', principle: 'transparency', q: 'How much do affected people need to understand or challenge an output?', options: [
    { label: 'Hardly: outputs are internal and low stakes', rating: 1 },
    { label: 'Sometimes: they may ask why', rating: 2 },
    { label: 'Often: they have a right to an explanation or appeal', rating: 3 } ] },
];

// Derived items, also 1 to 3, shown on the How scoring works page.
export const DERIVED_ITEMS = [
  { id: 'data', principle: 'privacy', label: 'Most sensitive data category chosen in step 1' },
  { id: 'technical', principle: 'robustness', label: 'Type of AI (rules 1, ML 2, generative or agent 3), one step lower when a person makes every decision and one step higher when outputs take effect without review; agents and biometric identification stay at 3' },
  { id: 'dependency', principle: 'accountability', label: 'Sourcing (in-house 1, vendor 2, foundation model 3)' },
];

// Client organisations in the demo.
export const DEMO_CLIENTS = [
  { id: 'northwind', name: 'Northwind Insurance', sector: 'Insurance', contact: 'Priya Nair' },
  { id: 'meridian', name: 'Meridian Bank', sector: 'Banking', contact: 'Arjun Mehta' },
  { id: 'lotus', name: 'Lotus Retail', sector: 'Retail', contact: 'Isha Banerjee' },
];

// EU AI Act Art. 5 prohibited practices (plus the Omnibus addition from 2 Dec 2026).
export const PROHIBITED = [
  'Social scoring that leads to unjustified or disproportionate treatment',
  'Subliminal, manipulative or deceptive techniques that cause significant harm',
  'Exploiting vulnerabilities due to age, disability or social or economic situation',
  'Predicting criminal offences based solely on profiling or personality traits',
  'Untargeted scraping of facial images to build recognition databases',
  'Emotion recognition in the workplace or in education (except medical or safety reasons)',
  'Biometric categorisation to infer race, political views, union membership, beliefs or sexual orientation',
  'Real-time remote biometric identification in public spaces for law enforcement',
  'Generating non-consensual intimate imagery or child sexual abuse material',
];

// EU AI Act Annex III areas.
export const ANNEX_III = [
  { id: 'none', label: 'None of these areas' },
  { id: 'biometrics', label: 'Biometrics: remote identification, categorisation or emotion recognition' },
  { id: 'infrastructure', label: 'Safety component of critical infrastructure (energy, water, traffic, digital)' },
  { id: 'education', label: 'Education: admission, assessment, proctoring' },
  { id: 'employment', label: 'Employment: recruitment, promotion, termination, task allocation, monitoring' },
  { id: 'essential', label: 'Essential services: credit scoring, life and health insurance pricing, public benefits, emergency call dispatch and emergency healthcare patient triage' },
  { id: 'law', label: 'Law enforcement' },
  { id: 'migration', label: 'Migration, asylum and border control' },
  { id: 'justice', label: 'Administration of justice or democratic processes' },
];

// EU AI Act role (Art. 3(3)-(4)). The provider develops the system or has it developed and places it on the market
// or puts it into service under its own name; the deployer uses it under its authority. An organisation that builds
// a system for its own use is both. When the role is not stated it follows the sourcing.
export const EU_ROLES = [
  { id: 'provider', label: 'Provider', hint: 'We develop it, or have it developed, and supply it to others under our name' },
  { id: 'deployer', label: 'Deployer', hint: 'We use a system that another organisation provides' },
  { id: 'both', label: 'Provider and deployer', hint: 'We develop it and use it ourselves' },
];
export function euRoles(profile = {}) {
  const r = EU_ROLES.some((x) => x.id === profile.euRole) ? profile.euRole : (profile.sourcing === 'vendor' ? 'deployer' : 'both');
  return { id: r, stated: r === profile.euRole, provider: r !== 'deployer', deployer: r !== 'provider', label: EU_ROLES.find((x) => x.id === r).label };
}

// EU AI Act Art. 50 transparency triggers.
export const TRANSPARENCY = [
  { id: 'chat', label: 'People interact with it directly (chatbot, voice assistant)' },
  { id: 'synthetic', label: 'It generates text, images, audio or video' },
  { id: 'deepfake', label: 'It creates realistic images, audio or video of real people or events' },
  { id: 'emotion', label: 'It recognises emotions or categorises people by biometrics' },
];

export const TIERS = {
  minimal: { label: 'Minimal', rank: 0, color: '#2F7D4F', bg: '#E8F3EC', review: 24, meaning: 'Reviewer sign-off at each stage. Periodic review every 24 months.' },
  limited: { label: 'Limited', rank: 1, color: '#A86A12', bg: '#FBF1DF', review: 12, meaning: 'Transparency duties apply. Periodic review every 12 months.' },
  high: { label: 'High', rank: 2, color: '#B83A2E', bg: '#FBE7E4', review: 6, meaning: 'Governance lead also signs stages 2, 5, 6 and every change (stage 8). Periodic review every 6 months.' },
  unacceptable: { label: 'Unacceptable', rank: 3, color: '#3B2350', bg: '#ECE6F2', review: 0, meaning: 'Prohibited practice. Cannot proceed; escalate to legal.' },
};
export const TIER_ORDER = ['minimal', 'limited', 'high', 'unacceptable'];

export function subjectFor(domainId) {
  return (DOMAINS.find((d) => d.id === domainId) || DOMAINS[DOMAINS.length - 1]).subject;
}

// Frameworks suggested from where the system is used.
export function suggestFrameworks(geos = []) {
  const out = new Set();
  if (geos.some(isEU)) { out.add('EU_AI_ACT'); out.add('GDPR'); }
  if (geos.includes('GB') || geos.includes('CH')) out.add('GDPR');
  if (geos.includes('IN') || geos.includes('GLOBAL')) out.add('DPDP');
  return [...out];
}

// Scoring version 2: one cut-off scale for every product, whatever laws are in scope. The laws set legal floors
// (see legalClass) and are reported one by one (see legalByLaw); they no longer move the score band. An
// administrator can change the scale (settings.cutoffs.SCALE).
export const SCALE_CUTOFFS = { limited: 40, high: 65 };
export function scaleFor(custom = {}) {
  const c = custom?.SCALE;
  return validCut(c) ? { limited: +c.limited, high: +c.high, from: [] } : { ...SCALE_CUTOFFS, from: [] };
}

// Scoring version 1 (assessments made before the single scale): tier cut-offs on the common 0-100 score, set per framework. When several apply, the strictest (lowest) wins.
// EU AI Act is a risk-tier law with fines up to 7% of turnover, so it escalates earliest; GDPR's "likely high risk"
// DPIA test sits in the middle; the DPDP Act has fewer AI-specific duties, so it escalates last.
export const TIER_CUTOFFS = {
  EU_AI_ACT: { limited: 30, high: 55 },
  GDPR: { limited: 35, high: 60 },
  DPDP: { limited: 40, high: 65 },
  DEFAULT: { limited: 35, high: 60 },
};
// Saved cut-offs are checked again here: a malformed entry (outside 1-100, or Limited not below High) falls back to the default.
function validCut(c) { return !!c && Number.isFinite(+c.limited) && Number.isFinite(+c.high) && +c.limited > 0 && +c.limited < +c.high && +c.high <= 100; }
export function cutoffsFor(fws = [], custom = {}) {
  const ok = Object.fromEntries(Object.entries(custom || {}).filter(([, c]) => validCut(c)).map(([k, c]) => [k, { limited: +c.limited, high: +c.high }]));
  const table = { ...TIER_CUTOFFS, ...ok };
  const list = fws.filter((f) => table[f]).map((f) => table[f]);
  if (!list.length) return { ...table.DEFAULT, from: [] };
  return { limited: Math.min(...list.map((c) => c.limited)), high: Math.min(...list.map((c) => c.high)), from: fws.filter((f) => table[f]) };
}
