// Printable HTML report for one system (open it and use Print > Save as PDF).
import { PILLARS, TIERS, PRINCIPLES, PRINCIPLE_IDS } from '../data/frameworks.js';
import { sectionName, sectionOrder, riskLabel } from './engine.js';
import { STAGES } from '../data/lifecycle.js';
import { geoName } from '../data/countries.js';
import { LEVEL_NAMES } from '../data/questionBank.js';

const E = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fw = sectionName;
// Numbers from the stored product: printed only if they really are numbers.
const N = (x) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? String(Number(x)) : '—');

export function reportHtml(s, audit, client) {
  const a = s.assessment; const r = a.results; const t = TIERS[r.tier];
  const ans = (q) => (a.answers[q.id] === 'na' ? 'Not applicable' : a.answers[q.id] === 'unknown' ? 'Not known' : q.options[a.answers[q.id]] ?? 'Not answered');
  const lvl = (q) => (a.answers[q.id] === 'na' ? '' : a.answers[q.id] === 'unknown' ? 'Scored as not in place' : LEVEL_NAMES[a.answers[q.id]] ?? '');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${E(s.code)} ${E(s.name)}</title>
<style>body{font-family:'IBM Plex Sans',Arial,sans-serif;color:#1B2232;margin:40px;max-width:980px;line-height:1.5}
h1{margin:0 0 4px}h2{margin-top:28px;border-bottom:1px solid #DDE2E8;padding-bottom:4px;font-size:18px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #EBEEF2;padding:6px 8px;text-align:left;vertical-align:top}th{color:#5A6478;font-weight:500}
.tier{display:inline-block;padding:3px 12px;border-radius:20px;font-weight:600;color:${E(t.color)};background:${E(t.bg)}}.mute{color:#5A6478}</style></head><body>
${/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(client?.brand?.logo || '') ? `<img src="${client.brand.logo}" alt="" style="max-height:42px;max-width:180px;float:right">` : ''}<p class="mute">AI system assessment report, generated ${new Date().toLocaleString('en-GB')}</p>
<h1>${E(s.code)}: ${E(s.name)}</h1>
<p><span class="tier">${E(t.label)} risk</span> &nbsp; Inherent score ${N(r.inherent)}/100, after controls ${N(r.residual)}/100. Control readiness ${N(r.readiness)}%.</p>
<p><b>Client:</b> ${E(client?.name || '')} &nbsp; <b>Business unit:</b> ${E(s.bu)} &nbsp; <b>Owner:</b> ${E(s.owner)} &nbsp; <b>Stage:</b> ${N(s.stage)}. ${E(STAGES[s.stage - 1]?.name)} &nbsp; <b>Status:</b> ${E(s.status)} &nbsp; <b>Next review:</b> ${E(s.nextReview || 'not set')}</p>
<h2>Purpose</h2><p>${E(s.description)}</p>
<h2>Why this tier</h2><ul>${r.reasons.map((x) => `<li>${E(x)}</li>`).join('')}</ul>
<h2>Responsible AI principles</h2><table><tr><th>Principle</th><th>Weight</th><th>Inherent risk</th><th>Control readiness</th></tr>${PRINCIPLE_IDS.map((k) => `<tr><td>${PRINCIPLES[k].name}<br><span class="mute">${E(PRINCIPLES[k].tagline)}</span></td><td>${PRINCIPLES[k].weight}</td><td>${E(riskLabel(r.principles[k].risk))} (${N(r.principles[k].risk)})</td><td>${N(r.principles[k].readiness)}%</td></tr>`).join('')}</table>
<h2>Compliance readiness</h2><table><tr><th>Framework</th><th>Score</th><th>Status</th><th>Critical gaps</th></tr>${sectionOrder(a.frameworks).map((k) => { const f = r.frameworks[k]; return `<tr><td>${E(fw(k))}</td><td>${N(f.score)}%</td><td>${E(f.status?.label)}</td><td>${E(f.criticalGaps.join(', ') || 'None')}</td></tr>`; }).join('')}</table>
<h2>Data governance maturity</h2><table><tr><th>Pillar</th><th>Score</th><th>Level</th></tr>${Object.entries(PILLARS).map(([k, p]) => `<tr><td>${p.name}</td><td>${N(r.pillars[k]?.score)}</td><td>${r.pillars[k]?.level ? E(`${r.pillars[k].level}, ${r.pillars[k].label}`) : 'Not assessed'}</td></tr>`).join('')}</table>
<h2>Data assets</h2><table><tr><th>Dataset</th><th>Source</th><th>Used as</th><th>Class</th><th>Owner / steward</th><th>Catalog</th><th>Lineage</th><th>Quality</th></tr>${s.datasets.map((d) => `<tr><td>${E(d.name)}</td><td>${E(d.sourceSystem)}</td><td>${E(d.role)}</td><td>${E(d.classification)}</td><td>${E(d.owner)} / ${E(d.steward || '—')}</td><td>${d.catalogued ? 'Yes' : 'No'}</td><td>${d.lineage ? 'Yes' : 'No'}</td><td>${d.qualityChecked ? 'Yes' : 'No'}</td></tr>`).join('') || '<tr><td colspan="8">None registered</td></tr>'}</table>
<p><b>Outputs go to:</b> ${E(s.outputs.join(', ') || 'not recorded')}</p>
<h2>Questionnaire (${N(a.questions.length)} questions: ${N(r.fixedCount)} fixed, ${N(r.adaptiveCount)} tailored by ${E(a.questionSource)})</h2>
<table><tr><th>Question</th><th>Evidence for</th><th>Answer</th><th>Level</th></tr>${a.questions.map((q) => `<tr><td>${E(q.q)}${q.kind !== 'core' ? ' <span class="mute">(tailored)</span>' : ''}</td><td class="mute">${E(Object.entries(q.maps).map(([k, v]) => `${fw(k)} ${v}`).join('; '))}</td><td>${E(ans(q))}</td><td>${E(lvl(q))}</td></tr>`).join('')}</table>
<h2>Actions</h2><table><tr><th>Priority</th><th>Action</th><th>Owner</th><th>Due</th><th>Status</th></tr>${s.actions.map((x) => `<tr><td>${E(x.priority)}</td><td><b>${E(x.topic)}</b><br>${E(x.action)}</td><td>${E(x.owner || 'Unassigned')}</td><td>${E(x.due)}</td><td>${E(x.status)}</td></tr>`).join('') || '<tr><td colspan="5">None</td></tr>'}</table>
<h2>Lifecycle record</h2><table><tr><th>Stage</th><th>Status</th><th>Checklist</th><th>Evidence attached</th><th>Sign-offs</th></tr>${STAGES.filter((x) => s.stages?.[x.n]).map((x) => { const r = s.stages[x.n]; return `<tr><td>${x.n}. ${E(x.name)}</td><td>${E(r.status)}${r.conditions ? ` (${E(r.conditions)})` : ''}</td><td>${x.checklist.filter((i) => r.checklist?.[i]).length}/${x.checklist.length}${Object.keys(r.skipped || {}).length ? `<br><span class="mute">Skipped: ${E(Object.entries(r.skipped).map(([i, k]) => `${i} (${k.reason})`).join('; '))}</span>` : ''}</td><td>${E(x.evidence.filter((i) => r.evidence?.[i]).map((i) => `${i}: ${r.evidence[i].file || r.evidence[i].ref}`).join('; ') || 'None')}</td><td>${E(Object.entries(r.approvals || {}).map(([k, v]) => `${k === 'lead' ? 'Governance lead' : 'Reviewer'}: ${v.outcome}${v.comment ? ` (${v.comment})` : ''}`).join('; ') || '—')}</td></tr>`; }).join('')}</table>
<h2>Audit trail</h2><table><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr>${audit.map((x) => `<tr><td>${E(x.at.slice(0, 16).replace('T', ' '))}</td><td>${E(x.actor)}</td><td>${E(x.action)}</td><td>${E(x.detail)}</td></tr>`).join('')}</table>
<p class="mute" style="margin-top:30px">Indicative assessment, not legal advice. Requirement summaries need legal review.</p></body></html>`;
}

export function downloadReport(s, audit, client) {
  const url = URL.createObjectURL(new Blob([reportHtml(s, audit, client)], { type: 'text/html' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${s.code}-report.html` });
  a.click(); URL.revokeObjectURL(url);
}
