// Document packs built from what is already in a product: an EU AI Act Annex IV technical documentation draft, and
// a DPDP pack (processing record, privacy notice draft, and, for Significant Data Fiduciaries, the DPIA and audit
// outline). Content is filled from stored fields only, never written by a language model, so the same product always
// gives the same document and nothing leaves the browser. Anything not yet recorded is marked as a gap.
import { STAGES } from '../data/lifecycle.js';
import { TIERS, DATA_CATEGORIES, SOURCING, SYSTEM_TYPES, ANNEX_III, PROFILE_QUESTIONS, PRINCIPLES, PRINCIPLE_IDS, selectionLabel } from '../data/frameworks.js';
import { geoName } from '../data/countries.js';
import { controlStatus } from '../data/controls.js';

const t = (v) => (v == null ? '' : String(v).trim());
const list = (xs) => (xs || []).filter(Boolean).join('; ');
const dt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const card = (s, k) => t(s.card?.[k]);
const profileAnswer = (s, id) => {
  const q = PROFILE_QUESTIONS.find((x) => x.id === id); const a = s.assessment?.profile?.answers?.[id];
  return q && Number.isInteger(a) ? q.options[a]?.label : '';
};

// What a stage holds as evidence: checks done, checks skipped with reasons, and file or link names.
function stageEvidence(s, n) {
  const st = STAGES[n - 1]; const rec = s.stages?.[n];
  if (!st || !rec) return '';
  const done = (st.checklist || []).filter((i) => rec.checklist?.[i]);
  const skipped = Object.entries(rec.skipped || {}).map(([i, v]) => `${i} (skipped: ${t(v.reason)})`);
  const files = Object.values(rec.evidence || {}).map((v) => t(v?.name || v?.url || (typeof v === 'string' ? v : ''))).filter(Boolean);
  if (!done.length && !skipped.length && !files.length && rec.status !== 'approved') return '';
  const status = { approved: 'approved', submitted: 'submitted for review', returned: 'returned for changes', open: 'in progress' }[rec.status] || rec.status;
  const parts = [`Stage ${n}, ${st.name}: ${status}${rec.approvedAt ? ` on ${dt(rec.approvedAt)}` : ''}. ${done.length} of ${(st.checklist || []).length} checks done.`];
  if (done.length) parts.push(`Done: ${done.join('; ')}.`);
  if (skipped.length) parts.push(`Skipped: ${skipped.join('; ')}.`);
  if (files.length) parts.push(`Evidence: ${files.join(', ')}.`);
  return parts.join(' ');
}

const metricsText = (s) => {
  const own = (s.card?.metrics || []).filter((m) => m.name && m.value).map((m) => `${m.name} ${m.value}${m.at ? ` (${m.at})` : ''}`);
  const reg = s.connector?.versions?.[0];
  const fromReg = reg?.metrics ? Object.entries(reg.metrics).map(([k, v]) => `${k} ${Math.round(v * 10000) / 10000} (registry, version ${reg.version})`) : [];
  return list([...own, ...fromReg]);
};
const datasetLine = (d) => `${d.name}${d.sourceSystem ? ` from ${d.sourceSystem}` : ''} (${[d.role, d.classification, d.personal ? 'personal data' : 'no personal data', d.owner ? `owner ${d.owner}` : '', d.steward ? `steward ${d.steward}` : '', d.catalogued ? 'catalogued' : 'not catalogued', d.lineage ? 'lineage recorded' : 'no lineage', d.qualityChecked ? 'quality checked' : 'quality not checked'].filter(Boolean).join(', ')})`;

// item(label, text, hint, ref): text '' marks a gap, with a hint on what to add.
const item = (label, text, hint, ref) => ({ label, text: t(text), hint, ref });

export function annexIV(s, { client } = {}) {
  const p = s.assessment?.profile || {}; const r = s.assessment?.results || {};
  const reg = s.connector; const latest = reg?.versions?.[0];
  const cs = controlStatus(s);
  const sections = [
    { h: '1. General description of the AI system', items: [
      item('Intended purpose', list([card(s, 'summary'), card(s, 'intendedUse') || s.description]), 'Describe what the system is for, who uses it and in which decisions.', 'Annex IV 1(a)'),
      item('Provider', client?.name, 'Name the provider (the organisation placing the system on the market or putting it into service).', 'Annex IV 1(a)'),
      item('Version', list([card(s, 'modelVersion') && `Version in production: ${card(s, 'modelVersion')}`, latest && `Latest registered version: ${latest.version} (${reg.model}, ${reg.kind === 'databricks-uc' ? 'Databricks Unity Catalog' : 'MLflow'}${latest.createdAt ? `, ${dt(latest.createdAt)}` : ''})`]), 'Record the version in production, or connect the model registry on the AI card.', 'Annex IV 1(a), 1(c)'),
      item('Type of AI and sourcing', list([selectionLabel(SYSTEM_TYPES, p.systemType, p.systemTypeOther), selectionLabel(SOURCING, p.sourcing, p.sourcingOther), card(s, 'modelName')]), 'State the kind of model and whether it is built, bought or a configured foundation model.', 'Annex IV 1(b)'),
      item('Where it is used', list((p.geos || []).map(geoName)), 'List the countries where the system is used.', 'Annex IV 1(d)'),
      item('Instructions for use: limitations and out-of-scope uses', list([card(s, 'outOfScope'), card(s, 'limitations')]), 'Record out-of-scope uses and known limitations on the AI card.', 'Annex IV 1(h); Art. 13'),
    ] },
    { h: '2. Elements of the system and its development', items: [
      item('Development methods and design choices', list([card(s, 'modelName'), stageEvidence(s, 4)]), 'Explain the model choice, alternatives considered and key design decisions (stage 4 evidence).', 'Annex IV 2(a), 2(b)'),
      item('Data used: sources, provenance and preparation', list([...(s.datasets || []).map(datasetLine), stageEvidence(s, 3)]), 'Register the datasets in "Data and lineage" and complete stage 3.', 'Annex IV 2(d); Art. 10'),
      item('Human oversight measures', list([profileAnswer(s, 'automation') && `Level of automation: ${profileAnswer(s, 'automation')}`, card(s, 'oversight')]), 'Describe who reviews outputs and how they override or stop the system.', 'Annex IV 2(e); Art. 14'),
      item('Planned changes', (s.events || []).filter((e) => e.kind === 'change').map((e) => `${dt(e.at)}: ${e.text}`).join('; '), 'Describe changes planned in advance and how they are controlled.', 'Annex IV 2(f)'),
      item('Validation and testing', list([stageEvidence(s, 5), metricsText(s) && `Metrics: ${metricsText(s)}`]), 'Complete stage 5 (testing and independent validation) and record the metrics.', 'Annex IV 2(g)'),
      item('Cybersecurity measures', '', 'Describe protections against attacks such as data poisoning, adversarial inputs and model theft.', 'Annex IV 2(h); Art. 15'),
    ] },
    { h: '3. Monitoring, functioning and control', items: [
      item('Capabilities and limitations in performance', list([card(s, 'limitations'), metricsText(s)]), 'Record accuracy and where the system performs worse.', 'Annex IV 3'),
      item('Persons and groups affected', list([card(s, 'affected'), profileAnswer(s, 'people'), profileAnswer(s, 'proxies') && `Attributes used: ${profileAnswer(s, 'proxies')}`]), 'Name the people affected, including those who never use the system.', 'Annex IV 3'),
      item('Foreseeable unintended outcomes and risks', list([...(r.reasons || []), card(s, 'ethics')]), 'Describe risks to health, safety and fundamental rights, and sources of discrimination.', 'Annex IV 3'),
      item('Input data specifications', profileAnswer(s, 'inputs') && `Input stability: ${profileAnswer(s, 'inputs')}`, 'Specify the input data the system expects in use.', 'Annex IV 3'),
    ] },
    { h: '4. Appropriateness of the performance metrics', items: [
      item('Metrics and why they fit this use', metricsText(s), 'List the metrics, their thresholds and why they suit this purpose.', 'Annex IV 4'),
    ] },
    { h: '5. Risk management system', items: [
      item('Risk classification', r.tier ? `${TIERS[r.tier]?.label} risk. Inherent score ${r.inherent}/100, ${r.residual}/100 after controls; control readiness ${r.readiness}%. Annex III area: ${selectionLabel(ANNEX_III, p.annex) || 'not stated'}.` : '', 'Complete the assessment.', 'Annex IV 5; Art. 9'),
      item('Principles and readiness', r.principles ? PRINCIPLE_IDS.map((k) => `${PRINCIPLES[k].name}: risk ${r.principles[k]?.risk}, readiness ${r.principles[k]?.readiness}%`).join('; ') : '', 'Complete the assessment.', 'Annex IV 5'),
      item('Controls', `${cs.filter((c) => c.status === 'Operating').length} of ${cs.length} controls operating${cs.some((c) => c.status === 'Gap') ? `; gaps: ${cs.filter((c) => c.status === 'Gap').map((c) => c.control.name).join(', ')}` : ''}. ${(s.actions || []).filter((a) => a.status !== 'Done').length} open actions: ${(s.actions || []).filter((a) => a.status !== 'Done').slice(0, 12).map((a) => t(a.action)).join('; ')}`, '', 'Annex IV 5'),
      item('Impact assessment', stageEvidence(s, 2), 'Complete stage 2 (impact assessment and requirements).', 'Annex IV 5; Art. 27'),
    ] },
    { h: '6. Changes made during the lifecycle', items: [
      item('Change history', list([...(s.history || []).map((h, i) => `Assessment ${i + 1} on ${dt(h.at)}: score ${h.residual}, readiness ${h.readiness}%`), ...(s.events || []).map((e) => `${dt(e.at)} ${e.kind}: ${e.text}`), ...(reg?.versions || []).slice(0, 10).map((v) => `Registry version ${v.version}${v.createdAt ? ` (${dt(v.createdAt)})` : ''}${v.description ? `: ${v.description}` : ''}`)]), 'Record changes through the change stage (stage 8).', 'Annex IV 6'),
      item('AI card versions', (s.card?.versions || []).map((v) => `Version ${v.version} on ${dt(v.at)}${v.changed?.length ? `: ${v.changed.join(', ')}` : ''}`).join('; '), '', 'Annex IV 6'),
    ] },
    { h: '7. Harmonised standards and other specifications applied', items: [
      item('Standards applied', '', 'List harmonised standards or common specifications applied, or describe the other solutions used to meet the requirements.', 'Annex IV 7'),
    ] },
    { h: '8. EU declaration of conformity', items: [
      item('Declaration', '', 'Attach a copy of the EU declaration of conformity once the conformity assessment is done.', 'Annex IV 8; Art. 47'),
    ] },
    { h: '9. Post-market monitoring', items: [
      item('Monitoring plan', list([stageEvidence(s, 7), s.nextReview && `Next periodic review: ${dt(s.nextReview)}`]), 'Complete stage 7 (production monitoring) with thresholds and owners.', 'Annex IV 9; Art. 72'),
      item('Incidents', (s.events || []).filter((e) => e.kind === 'incident').map((e) => `${dt(e.at)}: ${e.text}`).join('; '), '', 'Art. 73'),
    ] },
  ];
  return pack('Technical documentation (EU AI Act, Annex IV)', s, client, sections, [
    'Draft generated from GovernAI. It follows the structure of Annex IV of Regulation (EU) 2024/1689, as amended by Regulation (EU) 2026/1744. It is a starting point for your legal and technical teams, not a statement of conformity.',
    'Small and medium-sized enterprises and small mid-caps may provide these elements in a simplified form once the Commission publishes its simplified template.',
    r.tier !== 'high' ? `This product is classified as ${TIERS[r.tier]?.label?.toLowerCase() || 'not'} risk. Annex IV is required for high-risk systems; the draft is still useful as internal documentation.` : '',
  ]);
}

export function dpdpPack(s, { client, significant = false } = {}) {
  const p = s.assessment?.profile || {};
  const cats = (p.data || []).map((id) => DATA_CATEGORIES.find((c) => c.id === id)?.label).filter(Boolean);
  const personal = (s.datasets || []).filter((d) => d.personal);
  const kids = (p.data || []).includes('children') || /child|minor/i.test(profileAnswer(s, 'people'));
  const geos = (p.geos || []).filter((g) => g !== 'IN').map(geoName);
  const sections = [
    { h: 'Part A. Record of processing', items: [
      item('Data fiduciary', client?.name, 'Name the organisation that decides why and how the data is processed.', 'Sec. 2(i)'),
      item('Purpose of processing', list([card(s, 'intendedUse') || s.description]), 'State the specific purpose.', 'Sec. 4, 5'),
      item('Personal data processed', list(cats), 'List the categories of personal data.', 'Sec. 5; Rule 3(a)'),
      item('Data principals', list([profileAnswer(s, 'people'), card(s, 'affected')]), 'Describe whose data it is.', 'Sec. 2(j)'),
      item('Datasets with personal data', personal.map(datasetLine).join('; '), 'Register the datasets that hold personal data in "Data and lineage".', 'Sec. 8(1)'),
      item('Lawful ground (consent or legitimate use)', '', 'Record whether each purpose relies on consent (Sec. 6) or a legitimate use (Sec. 7).', 'Sec. 4, 6, 7'),
      item('Processing outside India', geos.length ? `Used in: ${geos.join(', ')}. Check that none is a country the Government has restricted.` : (p.geos || []).length ? 'Used in India only.' : '', 'List where data is processed or accessed from.', 'Sec. 16'),
      item('Children', kids ? 'The system may process children\'s data: verifiable parental consent is required, and tracking, behavioural monitoring and targeted advertising directed at children are not allowed.' : 'No children\'s data recorded.', '', 'Sec. 9; Rule 10'),
      item('Profiling and automated decisions', list([p.profiling === 'yes' ? 'Profiles individuals.' : p.profiling === 'no' ? 'Does not profile individuals.' : '', profileAnswer(s, 'automation')]), '', ''),
      item('Security safeguards', list([stageEvidence(s, 3), stageEvidence(s, 6)]), 'Describe encryption, access control, logging (kept at least one year) and backups.', 'Sec. 8(5); Rule 6'),
      item('Breach response', '', 'Name who informs affected people and the Data Protection Board without delay, and who files the detailed report within 72 hours.', 'Sec. 8(6); Rule 7'),
      item('Retention and erasure', '', 'State how long the data is kept and when it is erased once the purpose is served.', 'Sec. 8(7); Rule 8'),
      item('Contact for questions', '', 'Name the person (or Data Protection Officer) who answers data principals\' questions.', 'Sec. 8(9)'),
    ] },
    { h: 'Part B. Privacy notice (draft)', items: [
      item('What we collect', cats.length ? `We use the following personal data: ${cats.join(', ').toLowerCase()}.` : '', 'Itemise the personal data, in plain language.', 'Rule 3(a)'),
      item('Why we use it', card(s, 'intendedUse') || s.description ? `We use it to ${t(card(s, 'intendedUse') || s.description).replace(/^\w/, (c) => c.toLowerCase())}` : '', 'State the specific purpose and the service it enables.', 'Rule 3(b)'),
      item('How a person can withdraw consent', '', 'Give a link or route that makes withdrawing as easy as giving consent.', 'Sec. 6(4); Rule 3(c)'),
      item('How a person can use their rights', '', 'Explain how to ask for a summary of their data, correction, erasure and to nominate someone, and how to raise a grievance.', 'Sec. 11-14; Rule 3(c)'),
      item('How a person can complain to the Data Protection Board', 'If you are not satisfied with our response, you may complain to the Data Protection Board of India.', '', 'Rule 3(c)'),
    ] },
    ...(significant ? [{ h: 'Part C. Significant Data Fiduciary: impact assessment and audit', items: [
      item('Data protection impact assessment', list([stageEvidence(s, 2), ...(s.assessment?.results?.reasons || [])]), 'Assess the rights of data principals, the purpose, and the risks and how they are managed, at least once a year.', 'Sec. 10(2)(c); Rule 13(1)'),
      item('Annual audit', '', 'Record the independent data audit and the date its findings were reported to the Board.', 'Rule 13(1), 13(2)'),
      item('Due diligence on algorithmic software', list([stageEvidence(s, 5), metricsText(s) && `Metrics: ${metricsText(s)}`, card(s, 'limitations')]), 'Show that the algorithmic software is not likely to pose a risk to data principals\' rights.', 'Rule 13(3)'),
      item('Data Protection Officer', '', 'Name the DPO based in India and responsible to the Board of Directors.', 'Sec. 10(2)(a)'),
    ] }] : []),
  ];
  return pack('DPDP pack (Digital Personal Data Protection Act 2023 and Rules 2025)', s, client, sections, [
    'Draft generated from GovernAI for review by your Data Protection Officer or counsel. Most duties apply from 13 May 2027.',
    significant ? 'Includes Part C because the organisation was marked as a Significant Data Fiduciary.' : 'Part C (impact assessment and audit) applies only to organisations the Government designates as Significant Data Fiduciaries, and is left out.',
  ]);
}

function pack(title, s, client, sections, notes) {
  const all = sections.flatMap((x) => x.items).filter((i) => i.hint !== '' || i.text);
  const filled = all.filter((i) => i.text).length;
  return { title, product: { name: s.name, code: s.code, owner: s.owner, bu: s.bu }, client: client ? { name: client.name, brand: client.brand } : null,
    generatedAt: new Date().toISOString(), notes: notes.filter(Boolean), sections, coverage: { filled, total: all.length, pct: all.length ? Math.round((filled / all.length) * 100) : 0 } };
}

// ---------- Word file ----------
const dataUrlImage = (u) => {
  const m = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/.exec(u || '');
  if (!m) return null;
  const bin = atob(m[2]); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { type: m[1] === 'png' ? 'png' : 'jpg', data: bytes };
};

export async function packDocx(doc) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, Header, AlignmentType } = await import('docx');
  const accent = /^#[0-9a-f]{6}$/i.test(doc.client?.brand?.color || '') ? doc.client.brand.color.slice(1) : '1E3A8A';
  const img = dataUrlImage(doc.client?.brand?.logo);
  const cell = (children, w) => new TableCell({ width: { size: w, type: WidthType.PERCENTAGE }, children });
  const body = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: doc.title, color: accent })] }),
    new Paragraph({ children: [new TextRun({ text: `${doc.product.code}: ${doc.product.name}`, bold: true, size: 28 })] }),
    new Paragraph({ children: [new TextRun({ text: [doc.client?.name, doc.product.bu, doc.product.owner && `Owner ${doc.product.owner}`, `Generated ${new Date(doc.generatedAt).toLocaleString('en-GB')}`].filter(Boolean).join(' · '), color: '555555' })] }),
    new Paragraph({ children: [new TextRun({ text: `${doc.coverage.filled} of ${doc.coverage.total} items have content (${doc.coverage.pct}%). Items marked GAP need input.`, bold: true })] }),
    ...doc.notes.map((n) => new Paragraph({ children: [new TextRun({ text: n, italics: true, color: '555555' })] })),
  ];
  for (const sec of doc.sections) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: sec.h, color: accent })] }));
    body.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: sec.items.map((i) => new TableRow({ children: [
      cell([new Paragraph({ children: [new TextRun({ text: i.label, bold: true })] }), ...(i.ref ? [new Paragraph({ children: [new TextRun({ text: i.ref, size: 16, color: '666666' })] })] : [])], 30),
      cell(i.text ? [new Paragraph(i.text)] : [new Paragraph({ children: [new TextRun({ text: 'GAP. ', bold: true, color: 'B45309' }), new TextRun({ text: i.hint || 'Not recorded.', color: '7A4A07' })] })], 70),
    ] })) }));
  }
  const header = img ? { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new ImageRun({ type: img.type, data: img.data, transformation: { width: 110, height: 36 } })] })] }) } : undefined;
  const d = new Document({ creator: 'GovernAI', title: doc.title, sections: [{ headers: header, children: body }] });
  return Packer.toBlob(d);
}

export async function downloadPack(doc, filename) {
  const blob = await packDocx(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

