// What may leave the app for an AI model. Used in the browser before the call and again on the server,
// so a modified client still cannot push identifying data to the model.
//
// Two layers:
//  1. Allowlist: only coarse, non-identifying fields are sent (type of AI, domain, sourcing, country codes,
//     data categories, yes/no risk flags, framework ids). Names, owners, business units, organisations,
//     datasets, evidence, answers and notes are never part of the payload.
//  2. Scrubbing: the free-text description is cleaned of personal and secret data, and any known names
//     (product, owner, business unit, organisation, people) are replaced with neutral words.

const PATTERNS = [
  ['[email]', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
  ['[link]', /\b(?:https?:\/\/|www\.)[^\s<>"')]*[^\s<>"').,;:!?]/gi],
  ['[secret]', /\b(?:sk|pk|rk|ghp|gho|xox[abp]|AKIA|AIza|sb_secret|sb_publishable|eyJ)[A-Za-z0-9_\-.]{12,}/g],
  ['[ip address]', /\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
  ['[iban]', /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g],
  ['[card number]', /\b(?:\d[ -]?){13,19}\b/g],
  ['[id number]', /\b\d{4}\s?\d{4}\s?\d{4}\b/g],                     // Aadhaar-style 12 digits
  ['[id number]', /\b[A-Z]{5}\d{4}[A-Z]\b/g],                          // Indian PAN
  ['[id number]', /\b\d{3}-\d{2}-\d{4}\b/g],                           // US SSN
  ['[id number]', /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/gi], // UK NI number
  ['[id number]', /\b[A-Z]{1,2}\d{6,9}\b/g],                           // passport-like
  ['[phone]', /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)\d{3,5}[\s-]?\d{3,5}\b/g],
  ['[postcode]', /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g],            // UK postcode
  ['[number]', /\b\d{7,}\b/g],                                          // any other long number (accounts, policies, claims)
  ['[handle]', /(^|\s)@[A-Za-z0-9_]{3,}/g],
];
// Titles followed by capitalised words are treated as a person's name.
const TITLED = /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Shri|Smt|Sri)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}/g;

const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function scrubText(text, known = [], max = 700) {
  let t = String(text || '');
  // Contact details, identifiers and secrets first (so an email is removed whole), then known names
  // (longest first, whole words, any case), then titled names such as "Dr. Ravi Kumar".
  for (const [label, re] of PATTERNS) t = t.replace(re, (m, lead) => (label === '[handle]' ? `${lead || ''}${label}` : label));
  const terms = [...new Set(known.map((k) => String(k || '').trim()).filter((k) => k.length >= 3))].sort((a, b) => b.length - a.length);
  for (const k of terms) t = t.replace(new RegExp(`\\b${escapeRe(k)}\\b`, 'gi'), '[name]');
  t = t.replace(TITLED, '[person]');
  return t.replace(/\s+/g, ' ').trim().slice(0, max);
}

// Things in the profile that are names: product, owner, business unit, the words of the owner's name.
export function knownTermsFor(profile = {}, extra = []) {
  const owner = String(profile.owner || '');
  return [profile.name, profile.bu, owner, ...owner.split(/\s+/).filter((w) => w.length >= 3), ...extra].filter(Boolean);
}

const ID = /^[a-z0-9_-]{1,32}$/i;
const ids = (xs, n = 40) => (Array.isArray(xs) ? xs.filter((x) => typeof x === 'string' && ID.test(x)).slice(0, n) : []);
const flag = (x) => x === true;

// The only use-case shape an AI model ever sees.
export function safeUseCase(u = {}, known = []) {
  return {
    description: scrubText(u.description, known),
    domain: ID.test(u.domain || '') ? u.domain : '',
    systemType: ID.test(u.systemType || '') ? u.systemType : '',
    sourcing: ID.test(u.sourcing || '') ? u.sourcing : '',
    geos: ids(u.geos), data: ids(u.data), transparency: ids(u.transparency),
    highRisk: flag(u.highRisk), decisions: flag(u.decisions), fullyAutomated: flag(u.fullyAutomated),
  };
}

// Questions to avoid repeating are bank wording, but they are scrubbed too in case an administrator typed names in.
export const safeAvoid = (xs) => (Array.isArray(xs) ? xs.slice(0, 120).map((x) => scrubText(x, [], 300)).filter(Boolean) : []);

// Fails closed: true when text still looks like it holds something identifying.
export function looksSensitive(text) {
  const t = String(text || '');
  return PATTERNS.some(([, re]) => { re.lastIndex = 0; const hit = re.test(t); re.lastIndex = 0; return hit; }) || /\b(?:Mr|Mrs|Ms|Dr)\.?\s+[A-Z][a-z]+/.test(t);
}
