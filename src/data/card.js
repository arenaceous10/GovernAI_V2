// AI card fields, completeness and certification status (shared by the card page and the deck).
// The fields a card owner writes. `weight` drives the completeness score.
export const CARD_FIELDS = [
  { k: 'summary', label: 'Definition', hint: 'One sentence, as you would write it in a glossary: what it is and what it decides or produces.', rows: 2, weight: 2 },
  { k: 'intendedUse', label: 'Intended use', hint: 'Who uses it, for which decisions, in which process.', rows: 3, weight: 2 },
  { k: 'outOfScope', label: 'Out of scope and prohibited uses', hint: 'Uses it must not be put to.', rows: 2, weight: 2 },
  { k: 'affected', label: 'People affected', hint: 'Users, and people its outputs affect who never use it.', rows: 2, weight: 1 },
  { k: 'oversight', label: 'Human oversight', hint: 'Who reviews outputs, when, and how they override or escalate.', rows: 2, weight: 2 },
  { k: 'limitations', label: 'Known limitations', hint: 'Where it performs worse, conditions it was not tested for, failure modes.', rows: 3, weight: 2 },
  { k: 'ethics', label: 'Ethical considerations', hint: 'Fairness, privacy or societal concerns and how they are handled.', rows: 2, weight: 1 },
  { k: 'modelName', label: 'Model or service', hint: 'e.g. Gradient boosted trees, or the vendor product name.', weight: 1 },
  { k: 'modelVersion', label: 'Version in production', hint: 'e.g. 2.3.1', weight: 1 },
  { k: 'modelOwner', label: 'Model owner', hint: 'Technical owner, if different from the business owner.', weight: 1 },
];
const TOTAL_W = CARD_FIELDS.reduce((a, f) => a + f.weight, 0) + 2; // + metrics, tags

export function cardCompleteness(s) {
  const c = s.card || {};
  let w = CARD_FIELDS.reduce((a, f) => a + (String(c[f.k] || '').trim() ? f.weight : 0), 0);
  if ((c.metrics || []).some((m) => m.name && m.value)) w += 1;
  if ((c.tags || []).length) w += 1;
  return Math.round((w / TOTAL_W) * 100);
}

// Certification follows the lifecycle: the card is "Certified" once go-live (stage 6) is approved.
export function cardStatus(s) {
  if (s.status === 'Retired') return { label: 'Retired', tone: 'mute' };
  if (s.status === 'Blocked') return { label: 'Blocked', tone: 'bad' };
  if (s.stages?.[6]?.status === 'approved') return { label: 'Certified for production', tone: 'good' };
  if (s.stage >= 2) return { label: 'Under governance', tone: 'ok' };
  return { label: 'Candidate', tone: 'warn' };
}

