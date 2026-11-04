// Regulatory deadlines and which products they apply to. Dates follow the EU AI Act as amended by the
// Digital Omnibus on AI (Regulation (EU) 2026/1744) and India's DPDP Rules, 2025 (notified 13 Nov 2025).
// "applies" decides from a product's assessment whether the date matters for it. The Annex I date
// (2 Aug 2028, AI inside regulated products) is not listed: registration does not ask about it yet.
const sel = (s) => s.assessment?.frameworks || [];
const prof = (s) => s.assessment?.profile || {};
const tier = (s) => s.assessment?.results?.tier;

export const DEADLINES = [
  {
    id: 'eu-art50', fw: 'EU_AI_ACT', date: '2026-08-02', title: 'EU AI Act transparency duties (Art. 50)',
    what: 'Tell people they are dealing with AI, and label deepfakes.',
    applies: (s) => sel(s).includes('EU_AI_ACT') && (prof(s).transparency || []).length > 0,
  },
  {
    id: 'eu-marking', fw: 'EU_AI_ACT', date: '2026-12-02', title: 'EU AI Act machine-readable marking (Art. 50(2))',
    what: 'Mark AI-generated text, images, audio and video in a machine-readable way.',
    applies: (s) => sel(s).includes('EU_AI_ACT') && (prof(s).transparency || []).some((t) => t === 'synthetic' || t === 'deepfake'),
  },
  {
    id: 'dpdp-consent', fw: 'DPDP', date: '2026-11-13', title: 'DPDP consent manager registration (Rule 4)',
    what: 'Consent managers must be registered with the Data Protection Board.',
    applies: (s) => sel(s).includes('DPDP'),
  },
  {
    id: 'dpdp-full', fw: 'DPDP', date: '2027-05-13', title: 'DPDP Act substantive duties',
    what: 'Notice, consent, security safeguards, 72-hour breach reporting, data principal rights, children and transfers.',
    applies: (s) => sel(s).includes('DPDP'),
  },
  {
    id: 'eu-annex3', fw: 'EU_AI_ACT', date: '2027-12-02', title: 'EU AI Act high-risk obligations (Annex III)',
    what: 'Risk management, data governance, documentation, logging, human oversight, accuracy, registration.',
    applies: (s) => sel(s).includes('EU_AI_ACT') && (tier(s) === 'high' || (prof(s).annex && prof(s).annex !== 'none')),
  },
];

const DAY = 86400000;
export const daysUntil = (iso, now = Date.now()) => Math.ceil((new Date(`${iso}T00:00:00Z`).getTime() - now) / DAY);

// Deadlines for one product, soonest first. Past ones are dropped after 30 days.
export function deadlinesFor(s, now = Date.now()) {
  if (!s?.assessment || ['Retired', 'Draft'].includes(s.status)) return [];
  return DEADLINES.filter((d) => d.applies(s)).map((d) => ({ ...d, days: daysUntil(d.date, now) }))
    .filter((d) => d.days > -30).sort((a, b) => a.days - b.days);
}

// Across a portfolio: each deadline with the products it applies to.
export function deadlineRadar(systems, now = Date.now()) {
  return DEADLINES.map((d) => ({ ...d, days: daysUntil(d.date, now), products: systems.filter((s) => deadlinesFor(s, now).some((x) => x.id === d.id)) }))
    .filter((d) => d.products.length && d.days > -30).sort((a, b) => a.days - b.days);
}

export const urgency = (days) => (days < 0 ? 'past' : days <= 90 ? 'soon' : days <= 365 ? 'year' : 'later');
