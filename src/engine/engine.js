// Pure functions: no React, no storage. Same inputs always give the same outputs,
// so an assessment can be re-run and audited.
import {
  PRINCIPLES, PRINCIPLE_IDS, PROFILE_QUESTIONS, DATA_CATEGORIES, SYSTEM_TYPES, SOURCING, TIERS, TIER_ORDER,
  FRAMEWORKS, PILLARS, ANNEX_III, ALWAYS, RAI, DG, subjectFor, familyOf, cutoffsFor,
} from '../data/frameworks.js';
import { QUESTIONS, LEVEL_SCORES } from '../data/questionBank.js';

export const ADAPTIVE_SHARE = 0.25;           // 25% tailored to the use case, 75% fixed (target band 20-30%)
export const ACTION_BELOW = 70;               // answers scoring below "In place" create an action
export const READINESS_CREDIT = 0.35;         // mature controls can lower the risk score by up to 35%
export const SEVERE_AT = 75;                  // a principle at or above this inherent risk counts as severe

// Law names the AI must not bring in when that framework is not in scope.
const LAW_WORDS = {
  EU_AI_ACT: [/\bAI Act\b/i, /\bAnnex III\b/i],
  GDPR: [/\bGDPR\b/i, /\bDPIA\b/],
  DPDP: [/\bDPDP\b/i, /\bData Fiduciar/i, /\bData Principal/i],
  OTHER: [/\bHIPAA\b/i, /\bCCPA\b/i, /\bCPRA\b/i, /\bPDPA\b/i, /\bNIST\b/i, /\bISO\/?IEC\b/i, /\bFCA\b/i, /\bIRDAI\b/i, /\bSOX\b/i, /\bPCI\b/i],
};

export const sectionName = (k) => (k === 'DG' ? DG.name : k === 'RAI' ? RAI.name : FRAMEWORKS[k]?.name || k);

// ---------- profile ----------
export function emptyProfile() {
  return {
    name: '', bu: '', owner: '', description: '',
    domain: '', domainOther: '', systemType: '', systemTypeOther: '', sourcing: '', sourcingOther: '', geos: [], data: [],
    answers: {}, prohibited: [], annex: 'none', narrowTask: 'no', profiling: 'yes', transparency: [],
  };
}

export function profileRating(qid, profile) {
  const q = PROFILE_QUESTIONS.find((x) => x.id === qid);
  const i = profile.answers?.[qid];
  return i == null || !q?.options[i] ? 1 : q.options[i].rating;
}

function derivedRating(id, profile) {
  if (id === 'data') return Math.max(1, ...(profile.data || []).map((d) => DATA_CATEGORIES.find((c) => c.id === d)?.rating || 1));
  if (id === 'technical') return SYSTEM_TYPES.find((s) => s.id === profile.systemType)?.rating || 1;
  if (id === 'dependency') return SOURCING.find((s) => s.id === profile.sourcing)?.rating || 1;
  return 1;
}
const DERIVED_OF = { privacy: ['data'], robustness: ['technical'], accountability: ['dependency'] };

// Inherent risk per principle: the average of its 1-3 item ratings, mapped to 0-100.
export function principleRisk(profile) {
  const out = {};
  for (const p of PRINCIPLE_IDS) {
    const items = [
      ...PROFILE_QUESTIONS.filter((q) => q.principle === p).map((q) => profileRating(q.id, profile)),
      ...(DERIVED_OF[p] || []).map((d) => derivedRating(d, profile)),
    ];
    const avg = items.reduce((a, b) => a + b, 0) / items.length;
    const risk = Math.round(((avg - 1) / 2) * 100);
    out[p] = { risk, rating: risk >= 67 ? 3 : risk >= 34 ? 2 : 1, items };
  }
  return out;
}

export function inherentScore(pr) {
  return Math.round(PRINCIPLE_IDS.reduce((s, p) => s + PRINCIPLES[p].weight * pr[p].risk, 0) / 100);
}

// Tier for a score, using the cut-offs of the frameworks in scope.
const band = (s, cut = cutoffsFor([])) => (s >= cut.high ? 'high' : s >= cut.limited ? 'limited' : 'minimal');
export const tierBand = band;
export const stricter = (a, b) => (TIERS[a].rank >= TIERS[b].rank ? a : b);

// Legal floor by fixed rules; the score plays no part. Prohibited practices always apply;
// the Annex III and Art. 50 rules apply only when the EU AI Act is in scope.
export function legalClass(profile, fws) {
  if (profile.prohibited?.length) return { tier: 'unacceptable', reason: 'A prohibited practice applies' };
  if (fws && !fws.includes('EU_AI_ACT')) return { tier: 'minimal', reason: 'No legal floor: the EU AI Act is not in scope' };
  const annex = profile.annex || 'none';
  if (annex !== 'none') {
    const label = ANNEX_III.find((a) => a.id === annex)?.label.split(':')[0];
    const derogation = profile.narrowTask === 'yes' && profile.profiling === 'no';
    if (!derogation) return { tier: 'high', reason: `Annex III high-risk area: ${label}` };
    return profile.transparency?.length
      ? { tier: 'limited', reason: `Annex III area (${label}) but the Art. 6(3) exception applies; Art. 50 transparency still applies` }
      : { tier: 'minimal', reason: `Annex III area (${label}) but the Art. 6(3) exception applies (narrow task, no profiling); document this assessment` };
  }
  if (profile.transparency?.length) return { tier: 'limited', reason: 'Art. 50 transparency duties apply' };
  return { tier: 'minimal', reason: 'No prohibited practice, Annex III area or transparency duty found' };
}

// Flags used to pick tailored questions.
export function profileFlags(profile) {
  const data = profile.data || [];
  const legal = legalClass(profile);
  const fam = familyOf(profile.systemType);
  const t = [...(profile.transparency || []), ...(profile.systemType === 'chatbot' ? ['chat'] : []), ...(fam === 'genai' ? ['synthetic'] : [])];
  const r = (id) => profileRating(id, profile);
  return {
    domain: profile.domain, systemType: fam, data, annex: profile.annex,
    automation: r('automation'),
    highRisk: legal.tier === 'high' || legal.tier === 'unacceptable',
    genai: ['genai', 'agent'].includes(fam),
    agent: fam === 'agent',
    chat: t.includes('chat'), synthetic: t.includes('synthetic'), deepfake: t.includes('deepfake'), emotion: t.includes('emotion'),
    decisions: r('impact') >= 2,
    fullAuto: r('automation') === 3,
    personal: data.some((x) => x !== 'none'),
    special: data.some((x) => DATA_CATEGORIES.find((c) => c.id === x)?.special),
    children: data.includes('children'),
    vulnerable: r('people') === 3,
    large: r('scale') === 3,
    build: profile.sourcing === 'build',
    vendor: profile.sourcing === 'vendor' || profile.sourcing === 'foundation',
    foundation: profile.sourcing === 'foundation',
    multiGeo: (profile.geos || []).length > 1,
  };
}

const FLAG_REASONS = {
  highRisk: 'it falls in an EU AI Act high-risk area', genai: 'it is generative AI', agent: 'it is an AI agent',
  chat: 'people talk to it directly', synthetic: 'it generates content', deepfake: 'it creates realistic media',
  emotion: 'it recognises emotions or biometrics', decisions: 'its outputs affect decisions about people',
  fullAuto: 'outputs take effect without human review', personal: 'it uses personal data',
  special: 'it uses special category data', children: "it uses children's data", vulnerable: 'it affects vulnerable people',
  large: 'it affects more than 100,000 people', build: 'it is built in-house', vendor: 'it relies on a vendor',
  foundation: 'it uses a third-party foundation model', multiGeo: 'it operates in several jurisdictions',
};

function whyPicked(q, flags, kwHits) {
  const out = [];
  for (const k of Object.keys(FLAG_REASONS)) {
    if (flags[k] && !q.when({ ...flags, [k]: false })) out.push(FLAG_REASONS[k]);
  }
  if (flags.domain && !q.when({ ...flags, domain: 'other' })) out.push('of its business domain');
  if (flags.automation >= 2 && !q.when({ ...flags, automation: 1 })) out.push('a person does not make every decision');
  if (flags.systemType && !q.when({ ...flags, systemType: 'rules' })) out.push('of the type of AI');
  for (const c of flags.data) {
    if (!q.when({ ...flags, data: flags.data.filter((x) => x !== c) })) {
      out.push(`it uses ${DATA_CATEGORIES.find((x) => x.id === c)?.label.toLowerCase()}`);
    }
  }
  if (kwHits.length) out.push(`your description mentions "${kwHits[0]}"`);
  return out.length ? `Asked because ${[...new Set(out)].slice(0, 2).join(' and ')}.` : 'Asked because it is relevant to this use case.';
}

// ---------- questionnaire ----------
// In scope when its main section (first key in the map) is always-on (RAI, DG) or selected,
// or when any other law it maps to is selected. A "supports DG" link alone does not pull a law question in.
export const inScope = (q, fws) => {
  const keys = Object.keys(q.maps);
  return ALWAYS.includes(keys[0]) || keys.some((k) => !ALWAYS.includes(k) && fws.includes(k));
};
export const sectionOrder = (fws) => [...fws, ...ALWAYS];
export function sectionOf(q, fws) {
  return Object.keys(q.maps).find((k) => ALWAYS.includes(k) || fws.includes(k)) || 'RAI';
}

export function personalise(text, profile) {
  return String(text).replaceAll('{subject}', subjectFor(profile.domain));
}

// overrides: admin edits to wording, { [id]: { q, options } }. Scoring never changes with wording.
export function freeze(q, profile, source, why = '', overrides = {}) {
  const o = overrides[q.id] || {};
  const options = (o.options && o.options.length === 4 && o.options.every((x) => String(x).trim())) ? o.options : q.options;
  return {
    id: q.id, kind: q.kind, source, weight: q.weight, topic: q.topic, maps: q.maps, pillar: q.pillar || null,
    principle: q.principle, q: personalise(o.q?.trim() ? o.q : q.q, profile), options: options.slice(0, 4).map(String),
    na: q.na || null, action: q.action, why,
  };
}

// Questions an administrator added (settings.customQuestions). Same shape and scoring as the built-in bank;
// tailored-pool ones are eligible for every use case and ranked by weight and description keywords.
export const CUSTOM_PREFIX = 'CQ-';
export function customBank(custom = []) {
  return (Array.isArray(custom) ? custom : []).filter((c) => c && c.active !== false && c.q && Array.isArray(c.options) && c.options.length === 4 && c.section)
    .map((c) => ({
      id: c.id, kind: c.kind === 'adaptive' ? 'adaptive' : 'core', weight: [1, 2, 3].includes(+c.weight) ? +c.weight : 2,
      topic: c.topic || 'Custom question', maps: { [c.section]: c.ref || 'Custom' }, principle: c.principle || 'accountability',
      q: c.q, options: c.options.map(String), na: c.na || null, action: c.action || `Address: ${c.topic || c.q}`,
      when: () => true, rel: () => 3, kw: (c.keywords || []).map((k) => String(k).toLowerCase()).filter(Boolean), custom: true,
    }));
}
const bankWith = (custom) => [...QUESTIONS, ...customBank(custom)];

export function fixedQuestions(profile, fws, overrides = {}, custom = []) {
  return bankWith(custom).filter((q) => q.kind === 'core' && inScope(q, fws)).map((q) => freeze(q, profile, 'fixed', '', overrides));
}

export function adaptiveTarget(fixedCount) {
  return Math.round((fixedCount * ADAPTIVE_SHARE) / (1 - ADAPTIVE_SHARE));
}

// Rule-based tailoring: eligible questions are ranked by relevance; slots are shared out
// round-robin across the sections in scope so none is left without tailored questions.
export function rankAdaptive(profile, fws, custom = []) {
  const flags = profileFlags(profile);
  const desc = (profile.description || '').toLowerCase();
  return bankWith(custom).filter((q) => q.kind === 'adaptive' && inScope(q, fws) && q.when(flags))
    .map((q) => {
      const kwHits = (q.kw || []).filter((k) => desc.includes(k));
      const score = q.rel(flags) + q.weight * 1.5 + kwHits.length * 3 + (flags.highRisk ? q.weight : 0);
      return { q, score, why: whyPicked(q, flags, kwHits) };
    })
    .sort((a, b) => b.score - a.score || a.q.id.localeCompare(b.q.id));
}

export function selectAdaptive(profile, fws, count, overrides = {}, exclude = new Set(), custom = []) {
  const ranked = rankAdaptive(profile, fws, custom).filter((r) => !exclude.has(r.q.id));
  const lanes = sectionOrder(fws).map((fw) => ranked.filter((r) => r.q.maps[fw]));
  const picked = []; const seen = new Set();
  let progress = true;
  while (picked.length < count && progress) {
    progress = false;
    for (const lane of lanes) {
      if (picked.length >= count) break;
      const next = lane.find((r) => !seen.has(r.q.id));
      if (next) { seen.add(next.q.id); picked.push(next); progress = true; }
    }
  }
  return picked.map((r) => freeze(r.q, profile, 'rules', r.why, overrides));
}

export function buildQuestionnaire(profile, fws, overrides = {}, custom = []) {
  const fixed = fixedQuestions(profile, fws, overrides, custom);
  const target = adaptiveTarget(fixed.length);
  const adaptive = selectAdaptive(profile, fws, target, overrides, new Set(), custom);
  return { fixed, adaptive, target };
}

export function orderQuestions(questions, fws) {
  const order = sectionOrder(fws);
  return [...questions].sort((a, b) => order.indexOf(sectionOf(a, fws)) - order.indexOf(sectionOf(b, fws))
    || (a.kind === b.kind ? 0 : a.kind === 'core' ? -1 : 1));
}

// ---------- AI-written questions: strict validation, scores never come from the AI ----------
export function mentionsOutOfScopeLaw(text, fws) {
  return Object.entries(LAW_WORDS).some(([k, res]) => !fws.includes(k) && res.some((re) => re.test(text)));
}

export function validateAiQuestions(raw, fws, count, takenTexts = []) {
  const allowed = new Set([...fws, ...ALWAYS]);
  const out = []; const seen = new Set(takenTexts.map((t) => t.toLowerCase()));
  for (const item of Array.isArray(raw) ? raw : []) {
    if (out.length >= count) break;
    if (!item || typeof item !== 'object') continue;
    const q = String(item.q || '').trim();
    const fw = String(item.framework || '').trim();
    const opts = Array.isArray(item.options) ? item.options.map((o) => String(o || '').trim()).filter(Boolean) : [];
    if (q.length < 15 || q.length > 260 || !allowed.has(fw) || opts.length !== 4 || seen.has(q.toLowerCase())) continue;
    if (new Set(opts.map((o) => o.toLowerCase())).size !== 4) continue;
    const allText = [q, item.ref, item.action, item.why, ...opts].join(' ');
    if (mentionsOutOfScopeLaw(allText, fws)) continue;          // never bring in a law that was not chosen
    const pillar = fw === 'DG' ? (PILLARS[item.pillar] ? item.pillar : 'catalog') : null;
    const principle = PRINCIPLES[item.principle] ? item.principle : 'accountability';
    const weight = Math.min(3, Math.max(1, parseInt(item.weight, 10) || 2));
    seen.add(q.toLowerCase());
    out.push({
      id: `AI-${out.length + 1}`, kind: 'adaptive', source: 'ai', weight,
      topic: String(item.topic || 'Tailored check').slice(0, 48),
      maps: { [fw]: String(item.ref || (fw === 'DG' ? PILLARS[pillar].short : fw === 'RAI' ? PRINCIPLES[principle].name : 'General')).slice(0, 48) },
      pillar, principle, q: q.endsWith('?') ? q : `${q}?`, options: opts.map((o) => o.slice(0, 140)), na: null,
      action: String(item.action || `Close the gap: ${q}`).slice(0, 220),
      why: String(item.why || 'Written by AI for this use case.').slice(0, 200),
    });
  }
  return out;
}

export async function aiAdaptive(profile, fws, count, fixed, { timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const flags = profileFlags(profile);
    const res = await fetch('/api/generate-questions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({
        count, frameworks: fws,
        useCase: {
          name: profile.name, description: profile.description, domain: profile.domain, systemType: profile.systemType,
          sourcing: profile.sourcing, geos: profile.geos, data: profile.data, highRisk: flags.highRisk,
          decisions: flags.decisions, fullyAutomated: flags.fullAuto, transparency: profile.transparency,
        },
        avoid: fixed.map((q) => q.q),
      }),
    });
    if (!res.ok) return { questions: [], error: `AI service returned ${res.status}` };
    const body = await res.json();
    return { questions: validateAiQuestions(body.questions, fws, count, fixed.map((q) => q.q)), model: body.model };
  } catch (e) {
    return { questions: [], error: e.name === 'AbortError' ? 'AI service timed out' : 'AI service not reachable' };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- evidence ----------
export const hasEvidence = (e) => !!(e && (String(e.ref || '').trim() || String(e.file || '').trim()));

// 'na' | 'unanswered' | 'provided' | 'unsupported' (In place or Evidenced with nothing attached) | 'none'
export function evidenceState(q, answer, ev) {
  if (answer === 'na') return 'na';
  if (answer == null || answer === '') return 'unanswered';
  if (hasEvidence(ev)) return 'provided';
  return answer >= 2 ? 'unsupported' : 'none';
}

// Which answers the assessor must rate: every answer claiming a control is in place, and any evidence supplied.
export function needsRating(q, answer, ev) {
  const s = evidenceState(q, answer, ev);
  return s === 'provided' || s === 'unsupported';
}

export function evidenceSummary(questions, answers, evidence = {}, review = {}) {
  const out = { provided: 0, unsupported: 0, toRate: 0, rated: 0, Accepted: 0, Insufficient: 0, Missing: 0 };
  for (const q of questions) {
    const st = evidenceState(q, answers[q.id], evidence[q.id]);
    if (st === 'provided') out.provided++;
    if (st === 'unsupported') out.unsupported++;
    if (needsRating(q, answers[q.id], evidence[q.id])) {
      out.toRate++;
      const r = review[q.id];
      if (r) { out.rated++; out[r] = (out[r] || 0) + 1; }
    }
  }
  return out;
}

// ---------- scoring ----------
export function answerScore(q, a) {
  if (a === 'na' || a == null || a === '') return null;
  return LEVEL_SCORES[a] ?? null;
}

function weightedMean(items) {
  const w = items.reduce((s, x) => s + x.w, 0);
  return w ? Math.round(items.reduce((s, x) => s + x.w * x.s, 0) / w) : null;
}

export function readinessStatus(s) {
  if (s == null) return { label: 'Not assessed', tone: 'mute' };
  if (s >= 85) return { label: 'Ready', tone: 'good' };
  if (s >= 65) return { label: 'Partly ready', tone: 'ok' };
  if (s >= 40) return { label: 'Significant gaps', tone: 'warn' };
  return { label: 'Not ready', tone: 'bad' };
}

export function maturityLevel(s) {
  if (s == null) return { level: 0, label: 'Not assessed' };
  const levels = ['Initial', 'Developing', 'Defined', 'Managed', 'Optimised'];
  const i = Math.min(4, Math.floor(s / 20));
  return { level: i + 1, label: levels[i] };
}

export const riskLabel = (r) => (r >= 67 ? 'High' : r >= 34 ? 'Medium' : 'Low');

export function scoreAssessment(profile, fws, questions, answers, customCutoffs = {}) {
  const pr = principleRisk(profile);
  const inherent = inherentScore(pr);
  const legal = legalClass(profile, fws);
  const cut = cutoffsFor(fws, customCutoffs);
  const severe = PRINCIPLE_IDS.filter((p) => PRINCIPLES[p].critical && pr[p].risk >= SEVERE_AT);
  const scored = questions.map((q) => ({ q, s: answerScore(q, answers[q.id]) }));
  const answered = scored.filter((x) => x.s != null);
  const unanswered = questions.filter((q) => answers[q.id] == null || answers[q.id] === '').length;

  const frameworks = {};
  for (const fw of sectionOrder(fws)) {
    const mine = scored.filter((x) => x.q.maps[fw]);
    const done = mine.filter((x) => x.s != null);
    const score = weightedMean(done.map((x) => ({ w: x.q.weight, s: x.s })));
    frameworks[fw] = {
      score, status: readinessStatus(score), total: mine.length, answered: done.length,
      criticalGaps: done.filter((x) => x.q.weight === 3 && x.s <= 35).map((x) => x.q.topic),
    };
  }
  const pillars = {};
  for (const p of Object.keys(PILLARS)) {
    const s = weightedMean(answered.filter((x) => x.q.pillar === p).map((x) => ({ w: x.q.weight, s: x.s })));
    pillars[p] = { score: s, ...maturityLevel(s) };
  }
  const principles = {};
  for (const p of PRINCIPLE_IDS) {
    const mine = answered.filter((x) => x.q.principle === p);
    const readiness = weightedMean(mine.map((x) => ({ w: x.q.weight, s: x.s })));
    principles[p] = { risk: pr[p].risk, rating: pr[p].rating, readiness, controls: mine.length, items: pr[p].items };
  }
  const readiness = weightedMean(answered.map((x) => ({ w: x.q.weight, s: x.s }))) ?? 0;
  const residual = Math.round(inherent * (1 - READINESS_CREDIT * (readiness / 100)));
  const floor = severe.length >= 3 ? 'high' : 'minimal';

  const inherentTier = [legal.tier, band(inherent, cut), floor].reduce(stricter);
  const tier = [legal.tier, band(residual, cut), floor].reduce(stricter);

  const reasons = [`Risk score ${inherent}/100 across the six Responsible AI principles`];
  reasons.push(`Cut-offs from ${cut.from.length ? cut.from.map((f) => FRAMEWORKS[f].name).join(', ') : 'the default policy'}: Limited at ${cut.limited}, High at ${cut.high}`);
  reasons.push(`Controls in place (${readiness}%) bring the score to ${residual}/100: ${TIERS[band(residual, cut)].label} band`);
  if (legal.tier !== 'minimal' || profile.prohibited?.length) reasons.push(`Legal floor: ${TIERS[legal.tier].label}. ${legal.reason}`);
  if (severe.length >= 3) reasons.push(`Floor to High: ${severe.map((p) => PRINCIPLES[p].name).join(', ')} at severe risk`);

  return {
    principles, inherent, residual, legal, severe, inherentTier, tier, reasons, readiness, cutoffs: cut,
    readinessStatus: readinessStatus(readiness), frameworks, pillars,
    dg: { score: frameworks.DG.score, ...maturityLevel(frameworks.DG.score) },
    criticalGaps: answered.filter((x) => x.q.weight === 3 && x.s <= 35).map((x) => x.q.id),
    unanswered, questionCount: questions.length,
    fixedCount: questions.filter((q) => q.kind === 'core').length,
    adaptiveCount: questions.filter((q) => q.kind !== 'core').length,
  };
}

// Gaps become remediation actions with a priority and due date.
export function buildActions(questions, answers, tier, today = new Date()) {
  const out = [];
  for (const q of questions) {
    const s = answerScore(q, answers[q.id]);
    if (s == null || s >= ACTION_BELOW) continue;
    let priority = q.weight === 3 || (s === 0 && q.weight === 2) ? 'High' : q.weight === 2 ? 'Medium' : 'Low';
    if (tier === 'high' && priority === 'Medium' && s === 0) priority = 'High';
    const days = { High: 30, Medium: 60, Low: 90 }[priority];
    const due = new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);
    out.push({
      id: `${q.id}-${Math.random().toString(36).slice(2, 7)}`, qid: q.id, topic: q.topic, action: q.action,
      principle: q.principle,
      refs: Object.entries(q.maps).map(([k, v]) => `${sectionName(k)} ${v}`).join('; '),
      priority, due, status: 'Open', owner: '',
    });
  }
  const rank = { High: 0, Medium: 1, Low: 2 };
  return out.sort((a, b) => rank[a.priority] - rank[b.priority]);
}

export { TIER_ORDER };
