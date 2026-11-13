// Governance rules that sit around the score: the legal position law by law, answers that contradict the risk
// profile, evidence reuse, conditions of approval, go-live blockers, breach signals, incident reporting clocks and
// what a connected model registry can confirm. Pure functions: no React, no storage.
import { DATA_CATEGORIES, familyOf, euRoles, ANNEX_III } from '../data/frameworks.js';
import { legalClass, profileRating, hasLink, answerScore, effectiveAnswers, isUnknown, ACTION_BELOW } from './engine.js';
import { LEVEL_NAMES } from '../data/questionBank.js';
import { isMandatory } from '../data/controls.js';
import { AUTO_MAX_AGE_DAYS, autoMaxAge, pullState, evidenceCurrent, recordAsOf } from '../data/freshness.js';

const day = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- legal position, one entry per law in scope ----------
// Indicative screening, not legal advice: it says which duties the answers point to, so the right people are asked.
export function legalByLaw(profile, fws = []) {
  const out = {};
  const data = profile.data || [];
  const personal = data.some((d) => d !== 'none');
  const special = data.some((d) => DATA_CATEGORIES.find((c) => c.id === d)?.special);
  const children = data.includes('children');
  const r = (id) => profileRating(id, profile);
  const fam = familyOf(profile.systemType);
  if (fws.includes('EU_AI_ACT')) {
    const legal = legalClass(profile, fws);
    const category = { unacceptable: 'Prohibited', high: 'High-risk', limited: 'Transparency duties', minimal: 'Minimal risk' }[legal.tier];
    const area = profile.annex && profile.annex !== 'none' ? ANNEX_III.find((a) => a.id === profile.annex)?.label.split(':')[0] : null;
    const derogation = !!area && legal.tier !== 'high' && legal.tier !== 'unacceptable';
    out.EU_AI_ACT = { category, tier: legal.tier, reason: legal.reason, role: euRoles(profile).label, roleStated: euRoles(profile).stated,
      area, annexI: profile.annexI === 'yes', derogation, transparency: [...(profile.transparency || [])] };
  }
  if (fws.includes('GDPR')) {
    // Art. 35(3) and the EDPB criteria (WP248): two or more usually mean a DPIA is required.
    const criteria = [];
    if (r('impact') >= 2) criteria.push('evaluation or scoring of people');
    if (r('automation') === 3 && r('impact') >= 2) criteria.push('automated decisions with a significant effect');
    if (special) criteria.push('special category data');
    if (r('scale') === 3) criteria.push('large scale');
    if (children || r('people') === 3) criteria.push('vulnerable people');
    if (['genai', 'agent'].includes(fam) || profile.systemType === 'biometric') criteria.push('new technology');
    if (data.includes('behavioural')) criteria.push('tracking of behaviour or location');
    out.GDPR = {
      applies: personal, criteria: personal ? criteria : [],
      dpia: !personal ? 'na' : criteria.length >= 2 ? 'required' : criteria.length === 1 ? 'screen' : 'none',
      art22: personal && r('automation') === 3 && r('impact') >= 2, special, children,
    };
  }
  if (fws.includes('DPDP')) {
    out.DPDP = {
      applies: personal, children,
      // Significant Data Fiduciaries are notified by the Central Government (Sec. 10); the tool can only prompt the check.
      sdfCheck: personal && (r('scale') === 3 || special || children || ['credit', 'insurance', 'health'].includes(profile.domain)),
      disability: personal && r('people') === 3,
    };
  }
  return out;
}

// ---------- answers that contradict the risk profile ----------
// For the reviewer: each flag names the questions to look at. Nothing is changed automatically.
export function consistencyFlags(profile, fws, questions = [], answers = {}) {
  const has = new Set((questions || []).map((q) => q.id));
  const a = (id) => (has.has(id) ? answers[id] : undefined);
  const data = profile.data || [];
  const personal = data.some((d) => d !== 'none');
  const r = (id) => profileRating(id, profile);
  const out = [];
  const noPd = (questions || []).filter((q) => /no personal data/i.test(q.na || '') && answers[q.id] === 'na').map((q) => q.id);
  if (personal && noPd.length) out.push({ id: 'personal', qids: noPd, text: `The risk profile lists personal data, but ${plural(noPd.length, 'answer')} say the system uses no personal data.` });
  if (r('automation') <= 2 && a('EU-C5') === 0) out.push({ id: 'oversight', qids: ['EU-C5'], text: 'The risk profile says a person reviews or makes every decision, but the human oversight control is answered "No human oversight".' });
  if (r('explain') === 3 && a('RAI-C6') === 3) out.push({ id: 'explain', qids: ['RAI-C6'], text: 'The risk profile calls the model a black box, but decision factors are answered as explainable on demand.' });
  if (a('RAI-C3') === 'na' && (r('impact') >= 2 || r('people') >= 2)) out.push({ id: 'no-people', qids: ['RAI-C3'], text: 'Fairness thresholds are marked not applicable (no output about people), but the risk profile says outputs affect people.' });
  if (typeof a('EU-C8') === 'number' && a('EU-C8') >= 2 && a('DG-A4') === 0) out.push({ id: 'monitoring', qids: ['EU-C8', 'DG-A4'], text: 'Production monitoring is answered as in place, but input data is answered as not monitored for drift.' });
  if (a('GD-C3') === 'na' && fws.includes('GDPR') && legalByLaw(profile, ['GDPR']).GDPR.dpia === 'required') out.push({ id: 'dpia', qids: ['GD-C3'], text: 'The DPIA is marked not required, but the risk profile meets two or more of the criteria that usually require one.' });
  if (a('SH-C2') === 'na' && personal && ['vendor', 'foundation'].includes(profile.sourcing)) out.push({ id: 'processor', qids: ['SH-C2'], text: 'Processor contracts are marked not applicable, but the system relies on a vendor and uses personal data.' });
  return out;
}

// ---------- evidence reused across items ----------
// The same link or file attached to several items is not wrong, but the reviewer should know: one document rarely
// proves many different controls. Returns [{ key, label, count, items }] for evidence used min or more times.
const firstLink = (v) => (String(v || '').match(/https?:\/\/[^\s<>"'()[\]]{4,}/i) || [])[0];
export function evidenceReuse(evidence, min = 3) {
  const groups = new Map();
  for (const [item, v] of Object.entries(evidence || {})) {
    if (!v) continue;
    const link = firstLink(v.ref);
    const key = v.file ? `file:${String(v.file).trim().toLowerCase()}:${v.size ?? ''}` : link ? `link:${link.toLowerCase().replace(/[/.,;]+$/, '')}` : null;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { key, label: v.file ? String(v.file) : link, count: 0, items: [] });
    const g = groups.get(key); g.count++; g.items.push(item);
  }
  return [...groups.values()].filter((g) => g.count >= min).sort((x, y) => y.count - x.count);
}

// ---------- conditions of approval ----------
// "Approved with conditions" used to be a comment. It is now a tracked, high-priority action due in 30 days.
export function conditionAction(stage, conditions, now = new Date()) {
  const text = String(conditions || '').trim();
  if (!text) return null;
  // A gate override is recorded the same way: the reason usually promises something ("minutes to follow"), and a
  // bypassed gate should leave a follow-up that someone has to close.
  const override = /^Override:\s*/i.test(text);
  const body = text.replace(/^Override:\s*/i, '').slice(0, 600);
  return {
    id: `cond-${stage}-${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`, qid: `condition:${stage}`, source: 'condition', stage,
    topic: override ? `Override follow-up (stage ${stage})` : `Condition of approval (stage ${stage})`,
    action: override ? `Follow up the gate override at stage ${stage}: ${body}` : `Meet the condition set at stage ${stage}: ${body}`,
    principle: 'accountability', refs: `Stage ${stage} approval`, priority: 'High',
    due: day(new Date(now.getTime() + 30 * 86400000)), status: 'Open', owner: '', raisedBy: 'governance',
  };
}

// What must be settled before go-live (stage 6) can be submitted: every condition set at an earlier gate, and any
// high-priority action that is past its due date. High-priority actions still inside their date are a plan, not a breach.
export function goLiveBlockers(x, today = day(new Date())) {
  if (x?.stage !== 6) return [];
  const open = (x.actions || []).filter((a) => a.status !== 'Done');
  const cond = open.filter((a) => a.source === 'condition' && Number(a.stage) < 6);
  const late = open.filter((a) => a.source !== 'condition' && a.priority === 'High' && a.due && a.due < today);
  const out = [];
  if (cond.length) out.push(`${plural(cond.length, 'condition or override follow-up', 'conditions or override follow-ups')} from earlier stages still open: close ${cond.length === 1 ? 'it' : 'them'} on the Actions tab`);
  if (late.length) out.push(`${plural(late.length, 'high-priority action')} overdue: complete ${late.length === 1 ? 'it' : 'them'}, or agree a new date with the governance team`);
  return out;
}

// Items the "tick the optional checks" button may tick: never a mandatory one, each of those is ticked on its own.
export const bulkTickable = (items, tier, rules = {}) => (items || []).filter((i) => !isMandatory(i, tier, rules));

// ---------- model versions ----------
const lastChangeApproval = (x) => [x?.stages?.[8], ...(x?.rounds || []).filter((r) => Number(r.stage) === 8).map((r) => r.record)]
  .filter((r) => r?.status === 'approved' && r.approvedAt).map((r) => r.approvedAt).sort().at(-1) || '';
const verNum = (v) => (Number.isFinite(+v) ? +v : null);
// A "new version found" alert is settled once that version (or a later one) is approved, or a change was approved after it.
export function versionCovered(x, alert) {
  if (!alert?.version) return true;
  const n = verNum(alert.version);
  if ((x?.approvedVersions || []).some((v) => String(v.version) === String(alert.version) || (n != null && verNum(v.version) != null && verNum(v.version) >= n))) return true;
  return !!alert.at && lastChangeApproval(x) > alert.at;
}
export const pendingVersions = (x) => (x?.connector?.alerts || []).filter((a) => a.kind !== 'drift' && a.version && !versionCovered(x, a));
// Recorded when go-live (6) or a change (8) is approved: the version the approval covers.
export function approvedVersionEntry(x, stage, at) {
  // A change (stage 8) covers the version that was the registry's latest when the change was raised: the registry may
  // have moved on while it was under review, and that newer version has not been looked at.
  const raisedFor = stage === 8 ? [...(x?.events || [])].reverse().find((e) => e.kind === 'change')?.version : null;
  const reg = raisedFor ?? x?.connector?.latest; const card = cardVersion(x?.card?.modelVersion);
  const version = reg ?? card;
  if (version == null || String(version).trim() === '') return null;
  return { version: String(version), at, stage, source: reg != null ? 'registry' : 'card' };
}

// ---------- breach signals ----------
// Things that mean the approved picture no longer holds for a product in production. Those with suspends: true
// switch off control credit in the score (version 2) until they are resolved; drift is shown but does not, because a
// drifted column is a prompt to look, not proof that controls have failed.
export function breachSignals(x, now = new Date()) {
  if (!x || !(x.status === 'In production' || (Number(x.stage) >= 7 && Number(x.stage) <= 9 && x.stages?.[6]?.status === 'approved'))) return [];
  if (['Retired', 'Withdrawn', 'Draft'].includes(x.status)) return [];
  const today = day(now); const out = [];
  if (Number(x.stage) === 9 && x.stages?.[9]?.status !== 'approved') out.push({ id: 'incident', suspends: true, text: 'An incident is open' });
  const late = (x.actions || []).filter((a) => a.status !== 'Done' && a.priority === 'High' && a.due && a.due < today).length;
  if (late) out.push({ id: 'overdue', suspends: true, text: `${plural(late, 'high-priority action')} overdue` });
  const pend = pendingVersions(x);
  if (pend.length) out.push({ id: 'version', suspends: true, text: `Model version ${pend.at(-1).version} is in the registry but not yet approved` });
  const drifted = x.connector?.monitoring?.drift?.drifted?.length || 0;
  if (drifted) out.push({ id: 'drift', suspends: false, text: `${plural(drifted, 'input column')} drifted in the latest monitoring window` });
  return out;
}

// ---------- incident reporting clocks ----------
// Indicative deadlines from the moment the organisation became aware (taken as when the incident was recorded).
//   EU AI Act Art. 73: providers of high-risk systems report a serious incident immediately and no later than 15 days;
//     2 days for a widespread infringement or a serious and irreversible disruption of critical infrastructure;
//     10 days where a person has died. Deployers tell the provider at once (Art. 26(5)).
//   GDPR Art. 33: a personal data breach is notified to the supervisory authority within 72 hours where feasible.
//   DPDP Rule 7: the Board is told without delay, with the detailed report within 72 hours; affected people without delay.
export const INCIDENT_SEVERITY = [
  { id: 'minor', label: 'Minor', hint: 'No harm to people; fixed within normal operations' },
  { id: 'significant', label: 'Significant', hint: 'Wrong or unfair outputs reached people, or the service was degraded' },
  { id: 'serious', label: 'Serious', hint: 'Death or serious harm to health, serious harm to property or the environment, breach of fundamental rights, or disruption of critical infrastructure' },
];
export const SERIOUS_KINDS = [
  { id: 'general', label: 'Serious incident', days: 15 },
  { id: 'widespread', label: 'Widespread infringement or critical infrastructure disruption', days: 2 },
  { id: 'death', label: 'A person has died', days: 10 },
];
export function incidentClocks(incident, fws = [], { highRisk = false, role = '' } = {}) {
  const at = new Date(incident?.at || Date.now());
  if (Number.isNaN(at.getTime())) return [];
  const plus = (h) => new Date(at.getTime() + h * 3600000).toISOString();
  const out = [];
  if (fws.includes('EU_AI_ACT') && highRisk && incident?.severity === 'serious') {
    const k = SERIOUS_KINDS.find((s) => s.id === incident.seriousKind) || SERIOUS_KINDS[0];
    out.push({ law: 'EU_AI_ACT', ref: 'EU AI Act Art. 73', hours: k.days * 24, period: `${k.days} days`, due: plus(k.days * 24),
      label: `Report the serious incident to the market surveillance authority: immediately, and no later than ${k.days} days after becoming aware`,
      note: role === 'Deployer' ? 'As deployer, inform the provider and the authority without delay (Art. 26(5)); the provider files the report.' : '' });
  }
  if (incident?.personalData && fws.includes('GDPR')) out.push({ law: 'GDPR', ref: 'GDPR Art. 33-34', hours: 72, period: '72 hours', due: plus(72),
    label: 'If personal data was breached: notify the supervisory authority within 72 hours, and affected people without undue delay where the risk to them is high', note: '' });
  if (incident?.personalData && fws.includes('DPDP')) out.push({ law: 'DPDP', ref: 'DPDP Act Sec. 8(6), Rule 7', hours: 72, period: '72 hours', due: plus(72),
    label: 'If personal data was breached: tell the Data Protection Board and each affected Data Principal without delay, and send the Board the detailed report within 72 hours', note: '' });
  return out;
}

// ---------- controls that matter at a gate ----------
// The control assessment is answered once, at stage 2. At the gates where a control has to be working (validation,
// go-live, monitoring) the ones that are still not in place are put in front of the client and the reviewer again.
const STAGE_TOPICS = {
  5: /test|fairness|accura|robust|red-team|validation|factual|label|evaluation|proxy|across groups|job-related|local patients/i,
  6: /oversight|monitoring|incident|telling people|instructions|stop and roll|breach|logging|disclosure|hand-over|override/i,
  7: /monitoring|drift|outcome|incident|log retention|post-market|complaints|vendor change/i,
};
export function stageControlGaps(stage, questions = [], answers = {}, review = {}) {
  const re = STAGE_TOPICS[stage];
  if (!re) return [];
  const eff = effectiveAnswers(answers, review);
  return (questions || []).filter((q) => re.test(q.topic || ''))
    .map((q) => ({ q, s: answerScore(q, eff[q.id]) }))
    .filter((x) => x.s != null && x.s < ACTION_BELOW)
    .sort((a, b) => b.q.weight - a.q.weight)
    .map(({ q, s }) => ({ id: q.id, topic: q.topic, weight: q.weight, level: isUnknown(eff[q.id]) ? 'Not known' : LEVEL_NAMES[eff[q.id]] ?? String(s) }));
}

// ---------- how long a read from the registry counts ----------
// See data/freshness.js: 30 days by default, after which a read is shown as out of date and no longer counted.
const sourceName = (c) => (c?.kind === 'databricks-uc' ? 'Databricks' : 'the registry');

// ---------- the registry version a product runs on ----------
const usedVersion = (c) => {
  const vs = c?.versions || [];
  return vs.find((v) => (v.aliases || []).some((a) => /champion|prod/i.test(a)) || /production/i.test(v.stage || '')) || vs[0] || null;
};
const round = (n) => Math.round(n * 10000) / 10000;
// The version on the AI card without any alias written after it: "3 (champion)" is version 3.
export const cardVersion = (v) => { const t = String(v ?? '').trim().split(/[\s(]/)[0]; return t || null; };

// The catalog tables that fed the model: datasets logged on the training run, and tables the model version is
// packaged with (feature tables). Each table once, with where it was seen.
export function trainingTables(c) {
  const v = usedVersion(c);
  if (!v) return { version: null, tables: [], other: 0 };
  const map = new Map();
  const add = (name, via, extra = {}) => {
    if (!map.has(name)) map.set(name, { name, via: [], digest: '', context: '' });
    const t = map.get(name);
    if (!t.via.includes(via)) t.via.push(via);
    if (extra.digest && !t.digest) t.digest = extra.digest;
    if (extra.context && !t.context) t.context = extra.context;
  };
  const ds = v.run?.datasets || [];
  for (const d of ds) if (d?.table) add(d.table, 'run', d);
  for (const t of v.dependencies?.tables || []) add(t, 'model');
  return { version: String(v.version), tables: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)), other: ds.filter((d) => d && !d.table).length };
}

// What changed between two registered versions. Needs the run details of both (kept for the newest three).
export function versionDiff(c, from, to) {
  const find = (n) => (c?.versions || []).find((v) => String(v.version) === String(n));
  const a = find(from); const b = find(to);
  if (!a || !b || !a.run || !b.run) return null;
  const lowerIsBetter = (k) => /loss|error|mse|mae|rmse/i.test(k);
  const metrics = Object.keys(b.metrics || {}).filter((k) => Number.isFinite(a.metrics?.[k]) && Number.isFinite(b.metrics[k])).sort()
    .map((k) => ({ name: k, from: a.metrics[k], to: b.metrics[k], worse: lowerIsBetter(k) ? b.metrics[k] > a.metrics[k] : b.metrics[k] < a.metrics[k] }));
  const keys = [...new Set([...Object.keys(a.run.params || {}), ...Object.keys(b.run.params || {})])].sort();
  const params = keys.filter((k) => (a.run.params || {})[k] !== (b.run.params || {})[k]).map((k) => ({ name: k, from: a.run.params?.[k] ?? null, to: b.run.params?.[k] ?? null }));
  const tab = (v) => new Map((v.run.datasets || []).filter((d) => d.table).map((d) => [d.table, d.digest || '']));
  const ta = tab(a); const tb = tab(b);
  const data = [...new Set([...ta.keys(), ...tb.keys()])].sort().filter((t) => ta.get(t) !== tb.get(t)).map((t) => ({ table: t, from: ta.has(t) ? ta.get(t) : null, to: tb.has(t) ? tb.get(t) : null }));
  return { from: String(a.version), to: String(b.version), metrics, params, data, code: { from: a.run.code?.commit || '', to: b.run.code?.commit || '', changed: (a.run.code?.commit || '') !== (b.run.code?.commit || '') } };
}

// ---------- evidence GovernAI can attach from the registry ----------
// Keys are stage evidence names. Each entry is a plain-language statement of what was read, with the read date.
// Only facts the registry actually showed are offered; a missing fact offers nothing (it is never a "no").
export function autoEvidence(x, { now = new Date(), maxAgeDays = AUTO_MAX_AGE_DAYS } = {}) {
  const c = x?.connector;
  if (!c || !c.lastSync) return {};
  const src = sourceName(c);
  const st = pullState(c.lastSync, { now, maxAgeDays });
  const out = {};
  const put = (item, text) => { out[item] = { text: `${src}, read ${day(c.lastSync)}: ${text}`.slice(0, 900), at: c.lastSync, expired: st.expired, source: src, version: usedVersion(c)?.version ?? null }; };
  const v = usedVersion(c);
  const n = (c.versions || []).length;
  if (v) {
    const run = v.run;
    const bits = [`model ${c.model}, version ${v.version}${v.createdAt ? ` registered ${day(v.createdAt)}` : ''}`, `${plural(n, 'version')} kept`];
    if (run?.code?.commit) bits.push(`code commit ${run.code.commit.slice(0, 12)}`);
    if (run?.code?.source) bits.push(`trained from ${run.code.source}`);
    if (run?.flavors?.length) bits.push(`library ${run.flavors.join(', ')}`);
    const params = Object.entries(run?.params || {});
    if (params.length) bits.push(`parameters ${params.slice(0, 8).map(([k, val]) => `${k}=${val}`).join(', ')}${params.length > 8 ? ` and ${params.length - 8} more` : ''}`);
    put('Configuration and version records', `${bits.join('; ')}.`);
    const metrics = Object.entries(v.metrics || {});
    const evals = c.genai?.evaluations || [];
    if (metrics.length || evals.length) {
      const parts = [];
      if (metrics.length) parts.push(`version ${v.version} metrics from its training run: ${metrics.slice(0, 8).map(([k, val]) => `${k} ${round(val)}`).join(', ')}`);
      if (evals.length) parts.push(`evaluation run ${evals[0].name || evals[0].runId} on ${evals[0].at ? day(evals[0].at) : 'an unknown date'}: ${Object.entries(evals[0].metrics || {}).slice(0, 6).map(([k, val]) => `${k} ${round(val)}`).join(', ')}`);
      put('Evaluation and validation report', `${parts.join('; ')}. These are the figures as logged; they do not replace an independent validation.`);
    }
    // A change is compared with the version approved last (else the one before it in the registry).
    const prev = [...(x.approvedVersions || [])].reverse().find((a) => String(a.version) !== String(v.version))?.version
      ?? (c.versions || []).find((o) => (+o.version || 0) < (+v.version || 0))?.version;
    const diff = prev != null ? versionDiff(c, prev, v.version) : null;
    if (diff && (diff.metrics.length || diff.params.length || diff.data.length)) {
      const parts = [];
      if (diff.metrics.length) parts.push(`metrics ${diff.metrics.map((m) => `${m.name} ${round(m.from)} to ${round(m.to)}${m.worse ? ' (lower)' : ''}`).join(', ')}`);
      if (diff.params.length) parts.push(`parameters changed: ${diff.params.slice(0, 8).map((p) => `${p.name} ${p.from ?? 'not set'} to ${p.to ?? 'not set'}`).join(', ')}`);
      if (diff.data.length) parts.push(`training data changed: ${diff.data.slice(0, 6).map((d) => d.table).join(', ')}`);
      if (diff.code.changed) parts.push('code version changed');
      put('Regression results', `version ${diff.to} compared with version ${diff.from}: ${parts.join('; ')}.`);
    }
  }
  const tt = trainingTables(c);
  const ucd = (x.datasets || []).filter((d) => d.uc?.name);
  const wl = x.lineage?.nodes?.length ? x.lineage : null;
  if (tt.tables.length || ucd.some((d) => d.uc.lineageSource) || wl) {
    const parts = [];
    if (tt.tables.length) parts.push(`version ${tt.version} was trained on ${tt.tables.map((t) => `${t.name}${t.digest ? ` (digest ${t.digest})` : ''}`).join(', ')}`);
    if (wl) {
      const nt = wl.nodes.filter((n) => n.kind === 'table').length; const nf = wl.nodes.filter((n) => n.kind === 'path').length;
      const orig = originalSources(wl);
      parts.push(`lineage read ${day(wl.readAt)}: ${plural(nt, 'table')}${nf ? ` and ${plural(nf, 'file location')}` : ''}, up to ${plural(wl.layers, 'step')} upstream${orig.length ? `, original sources ${orig.slice(0, 6).join(', ')}${orig.length > 6 ? ` and ${orig.length - 6} more` : ''}` : ''}${wl.truncated ? ' (the walk stopped early, so this is not complete)' : ''}`);
    }
    const lin = ucd.filter((d) => (d.uc.upstream?.length || 0) + (d.uc.downstream?.length || 0) > 0);
    if (lin.length) parts.push(`lineage recorded for ${lin.map((d) => `${d.uc.name}${d.uc.upstream?.length ? ` (from ${d.uc.upstream.slice(0, 4).join(', ')})` : ''}`).join('; ')}`);
    const owners = ucd.filter((d) => d.owner);
    if (owners.length) parts.push(`owners: ${owners.map((d) => `${d.uc.name} ${d.owner}`).slice(0, 6).join(', ')}`);
    if (parts.length) put('Dataset lineage, version and access record', `${parts.join('; ')}.`);
  }
  const mon = c.monitoring;
  if (String(mon?.monitor?.status || '').toUpperCase() === 'ACTIVE') {
    const parts = [`a data monitor is active on ${mon.table || 'the monitored table'}`];
    if (mon.drift) parts.push(`latest window ${mon.drift.windowEnd ? day(mon.drift.windowEnd) : 'not dated'}: ${mon.drift.checked} columns checked, ${mon.drift.drifted?.length || 0} drifted`);
    const pm = Object.entries(mon.performance?.metrics || {});
    if (pm.length) parts.push(`live performance ${pm.slice(0, 6).map(([k, val]) => `${k.replace(/_/g, ' ')} ${round(val)}`).join(', ')}`);
    put('Monitoring dashboard and reports', `${parts.join('; ')}.`);
    const slices = mon.performance?.slices || [];
    if (slices.length) {
      const keys = [...new Set(slices.map((s0) => s0.key))];
      const first = Object.keys(slices[0].metrics || {})[0];
      const line = first ? slices.slice(0, 10).map((s0) => `${s0.key} ${s0.value}: ${Number.isFinite(s0.metrics?.[first]) ? round(s0.metrics[first]) : 'n/a'}`).join(', ') : '';
      put('Fairness and subgroup assessment', `live performance is reported by ${keys.join(', ')}${line ? ` (${first.replace(/_/g, ' ')}: ${line})` : ''}. Compare the groups; the figures alone are not a fairness conclusion.`);
    }
  }
  return out;
}

// An automatic statement is a copy of what the registry showed on one day. If the registry (read again) now shows
// something else, or nothing, the reviewer is told. Only the facts are compared, not the read date. This also
// catches a statement that was altered after it was attached.
const factsOf = (text) => String(text || '').replace(/^[^:]*, read \d{4}-\d{2}-\d{2}: /, '');
export function autoMismatch(x, rec) {
  const now = autoEvidence(x, { maxAgeDays: 36500 });
  const out = [];
  for (const [item, v] of Object.entries(rec?.evidence || {})) {
    if (!v?.auto) continue;
    if (!now[item]) out.push({ item, reason: 'gone' });
    else if (factsOf(now[item].text) !== factsOf(v.ref)) out.push({ item, reason: 'differs', now: now[item].text });
  }
  return out;
}

// In a lineage walked from Databricks: the nodes nothing else feeds (the files and tables everything starts from).
export function originalSources(l) {
  const fed = new Set((l?.edges || []).map((e) => e.to));
  const roots = new Set(l?.roots || []);
  return (l?.nodes || []).filter((n) => !fed.has(n.name) && !roots.has(n.name)).map((n) => n.name).sort();
}

// ---------- what a connected registry can confirm ----------
// Checklist items where the registry gives an independent reading. The tick stays with the client; beside it the
// screen shows "auto-verified" with the read date, "out of date" once the read is too old, or "not confirmed".
// Keys are checklist item texts.
export function registryChecks(x, { now = new Date(), maxAgeDays = AUTO_MAX_AGE_DAYS } = {}) {
  const c = x?.connector;
  if (!c) return {};
  const st = pullState(c.lastSync, { now, maxAgeDays });
  const stamp = { at: c.lastSync || null, expired: st.expired, source: sourceName(c) };
  const out = {};
  const mon = c.monitoring?.monitor?.status;
  out['Monitoring dashboards and alerts are live.'] = String(mon || '').toUpperCase() === 'ACTIVE'
    ? { ok: true, note: `A data monitor is active on ${c.monitoring.table || 'the monitored table'}` }
    : { ok: false, note: mon ? `The data monitor status is ${mon}` : 'No active data monitor was found in the registry workspace' };
  // "Fill from registry" writes the version with its alias, e.g. "3 (champion)": compare the version itself.
  const card = cardVersion(x.card?.modelVersion);
  out['Approval status and production version are updated in the inventory.'] = c.latest != null && card != null && String(card) === String(c.latest)
    ? { ok: true, note: `The AI card and the registry both say version ${c.latest}` }
    : { ok: false, note: c.latest == null ? 'The registry has no version yet' : `The registry's latest version is ${c.latest}; the AI card says ${card || 'nothing'}` };
  const n = (c.versions || []).length;
  out['Previous configuration is recoverable.'] = n >= 2
    ? { ok: true, note: `${n} versions are kept in the registry, so the previous one can be restored` }
    : { ok: false, note: 'The registry holds a single version, so there is nothing to roll back to' };
  // Only a positive reading: testing by group may well have been done somewhere the registry cannot see.
  const groups = [...new Set((c.monitoring?.performance?.slices || []).map((s0) => s0.key))];
  if (groups.length) out['Results are analyzed by relevant groups and worst-performing segments.'] = { ok: true, note: `The monitor reports performance by ${groups.join(', ')}` };
  for (const k of Object.keys(out)) out[k] = { ...out[k], ...stamp };
  return out;
}

// ---------- what the catalog shows against what was declared ----------
// For the reviewer and the client. Each flag says what to look at; nothing is changed automatically.
export function databricksFlags(x) {
  if (!x) return [];
  const out = [];
  const ds = x.datasets || [];
  const tagged = ds.filter((d) => d.uc?.personal?.tagged?.length);
  const cols = (d) => [...new Set(d.uc.personal.tagged.map((t) => t.column))];
  const data = x.assessment?.profile?.data || [];
  const declaredPersonal = data.some((d) => d !== 'none');
  if (tagged.length && !declaredPersonal) {
    out.push({ id: 'personal-profile', text: `The risk profile says no personal data is used, but Unity Catalog tags columns as personal or sensitive: ${tagged.map((d) => `${d.uc.name} (${cols(d).slice(0, 5).join(', ')})`).join('; ')}. Re-assess the product, or correct the tags.` });
  } else {
    const wrong = tagged.filter((d) => !d.personal);
    if (wrong.length) out.push({ id: 'personal-dataset', text: `${plural(wrong.length, 'dataset')} marked "no personal data" ${wrong.length === 1 ? 'has' : 'have'} columns tagged as personal or sensitive in Unity Catalog: ${wrong.map((d) => `${d.uc.name} (${cols(d).slice(0, 5).join(', ')})`).join('; ')}.` });
  }
  const tt = trainingTables(x.connector);
  const known = new Set(ds.flatMap((d) => [d.uc?.name, d.name]).filter(Boolean));
  const missing = tt.tables.filter((t) => !known.has(t.name));
  if (missing.length) out.push({ id: 'undeclared', text: `Model version ${tt.version} was trained on ${plural(missing.length, 'table')} not registered under Data and lineage: ${missing.map((t) => t.name).join(', ')}. Import ${missing.length === 1 ? 'it' : 'them'} so ownership, lineage and personal data are checked.` });
  const has = new Set((x.assessment?.questions || []).map((q) => q.id));
  const read = ds.filter((d) => d.uc?.lineageSource);
  if (has.has('DG-C2') && typeof x.assessment?.answers?.['DG-C2'] === 'number' && x.assessment.answers['DG-C2'] >= 2 && read.length && !(x.lineage?.edges?.length)
    && !read.some((d) => (d.uc.upstream?.length || 0) + (d.uc.downstream?.length || 0) > 0)) {
    out.push({ id: 'lineage', text: `Data lineage is answered as documented, but Unity Catalog shows no lineage for the ${plural(read.length, 'imported table')}: ${read.map((d) => d.uc.name).slice(0, 5).join(', ')}.` });
  }
  return out;
}

// ---------- live metrics against the values approved on the AI card ----------
// Card metrics are free text ("0.90", "85%"). A live value more than `tolerance` below the approved one is a breach.
const LIVE_KEYS = {
  recall: ['recall_positive', 'recall'], sensitivity: ['recall_positive', 'recall'], precision: ['precision_positive', 'precision'],
  f1: ['f1_positive', 'f1_score'], 'f1 score': ['f1_positive', 'f1_score'], accuracy: ['accuracy_score'], auc: ['roc_auc'], 'roc auc': ['roc_auc'], auroc: ['roc_auc'], r2: ['r2_score'],
};
const parseMetric = (v) => {
  const m = String(v ?? '').trim().match(/^(-?\d+(?:\.\d+)?)\s*(%?)$/);
  if (!m) return null;
  return m[2] ? +m[1] / 100 : +m[1];
};
export function compareMetrics(cardMetrics, live, tolerance = 0.05) {
  if (!live || typeof live !== 'object') return [];
  const out = [];
  for (const m of cardMetrics || []) {
    const keys = LIVE_KEYS[String(m?.name || '').trim().toLowerCase()];
    const approved = parseMetric(m?.value);
    if (!keys || approved == null) continue;
    const k = keys.find((x) => Number.isFinite(live[x]));
    if (!k) continue;
    const lv = live[k];
    out.push({ name: m.name, key: k, approved, live: lv, drop: Math.round((approved - lv) * 10000) / 10000, breach: approved - lv > tolerance });
  }
  return out;
}

export { hasLink, AUTO_MAX_AGE_DAYS, autoMaxAge, pullState, evidenceCurrent, recordAsOf };
