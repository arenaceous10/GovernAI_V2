// Dashboard deck for one AI product: a PowerPoint file with native (editable) charts.
// Built in the browser; nothing leaves the device. pptxgenjs is loaded only when a deck is requested.
import { PRINCIPLES, PRINCIPLE_IDS, PILLARS, TIERS } from '../data/frameworks.js';
import { STAGES, ROLES, STAGE_STATUS } from '../data/lifecycle.js';
import { deadlinesFor } from '../data/deadlines.js';
import { controlStatus, compassScores, COMPASS, COMPASS_IDS, COMPASS_PHASES } from '../data/controls.js';
import { sectionName, sectionOrder } from './engine.js';
import { swot, keyMessages, answerMix, checklistByStage, whatIf } from './insights.js';
import { cardCompleteness, cardStatus } from '../data/card.js';

const C = { navy: '121A2E', navy2: '1B2540', blue: '2A4EEF', cyan: '2FA8E0', ink: '1B2232', mute: '5A6478', line: 'DDE2E8', bg: 'F4F6FA', good: '2F7D4F', ok: '4F6F9E', warn: 'A86A12', bad: 'B83A2E', white: 'FFFFFF' };
const FONT = 'Calibri';
const hex = (x) => x.replace('#', '');
const tone = (v) => (v == null ? C.mute : v >= 70 ? C.good : v >= 40 ? C.warn : C.bad);
const pctFill = (v) => (v == null ? 'EEF1F6' : v >= 70 ? 'D7EEDF' : v >= 40 ? 'F8E7C4' : 'F6D2CD');
const trim = (t, n) => (String(t || '').length > n ? `${String(t).slice(0, n - 1)}…` : String(t || ''));

export async function buildDeck(s, { audit = [], client = null, rules = {} } = {}) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pptx.title = `${s.code} ${s.name} governance dashboard`;
  pptx.company = client?.name || '';
  const a = s.assessment; const r = a.results; const t = TIERS[r.tier];
  const W = 13.33;
  let page = 0;
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  const slide = (title, sub) => {
    const sl = pptx.addSlide(); page += 1;
    sl.background = { color: C.white };
    sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.08, fill: { color: C.blue }, line: { color: C.blue } });
    sl.addText(title, { x: 0.5, y: 0.28, w: 9.5, h: 0.5, fontFace: FONT, fontSize: 24, bold: true, color: C.ink });
    if (sub) sl.addText(sub, { x: 0.5, y: 0.78, w: 11, h: 0.32, fontFace: FONT, fontSize: 12, color: C.mute });
    sl.addText(`${s.code} · ${s.name}`, { x: 0.5, y: 7.05, w: 8, h: 0.3, fontFace: FONT, fontSize: 9, color: C.mute });
    sl.addText(`${page}`, { x: 12.3, y: 7.05, w: 0.5, h: 0.3, fontFace: FONT, fontSize: 9, color: C.mute, align: 'right' });
    return sl;
  };
  const tile = (sl, x, y, w, h, value, label, color = C.ink, detail = '') => {
    sl.addShape(pptx.ShapeType.roundRect, { x, y, w, h, fill: { color: C.bg }, line: { color: C.line, width: 0.75 }, rectRadius: 0.08 });
    sl.addText(String(value), { x: x + 0.15, y: y + 0.1, w: w - 0.3, h: h * 0.5, fontFace: FONT, fontSize: 26, bold: true, color });
    sl.addText(label, { x: x + 0.15, y: y + h * 0.55, w: w - 0.3, h: 0.3, fontFace: FONT, fontSize: 11, color: C.mute });
    if (detail) sl.addText(detail, { x: x + 0.15, y: y + h * 0.55 + 0.26, w: w - 0.3, h: 0.28, fontFace: FONT, fontSize: 9, color: C.mute });
  };
  const box = (sl, x, y, w, h, title) => {
    sl.addShape(pptx.ShapeType.roundRect, { x, y, w, h, fill: { color: C.white }, line: { color: C.line, width: 0.75 }, rectRadius: 0.06 });
    if (title) sl.addText(title, { x: x + 0.2, y: y + 0.1, w: w - 0.4, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: C.ink });
  };
  const bullets = (sl, items, x, y, w, h, size = 12, color = C.ink) => sl.addText(items.map((txt) => ({ text: txt, options: { bullet: { indent: 14 }, paraSpaceAfter: 4 } })), { x, y, w, h, fontFace: FONT, fontSize: size, color, valign: 'top' });
  const chartBase = { catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT, catAxisLabelFontSize: 10, valAxisLabelFontSize: 9, catAxisLabelColor: C.mute, valAxisLabelColor: C.mute, valGridLine: { color: 'E6EAF0', size: 0.5 }, legendFontFace: FONT, legendFontSize: 10, dataLabelFontFace: FONT, dataLabelFontSize: 9 };

  // 1. Cover
  {
    const sl = pptx.addSlide(); page += 1;
    sl.background = { color: C.navy };
    sl.addShape(pptx.ShapeType.ellipse, { x: 9.2, y: -2.2, w: 6, h: 6, fill: { color: C.cyan, transparency: 82 }, line: { color: C.navy, transparency: 100 } });
    sl.addShape(pptx.ShapeType.ellipse, { x: -1.8, y: 4.6, w: 5, h: 5, fill: { color: C.blue, transparency: 80 }, line: { color: C.navy, transparency: 100 } });
    sl.addText('AI GOVERNANCE DASHBOARD', { x: 0.8, y: 1.3, w: 10, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: 'F5B544', charSpacing: 2 });
    sl.addText(s.name, { x: 0.8, y: 1.8, w: 11, h: 1.1, fontFace: FONT, fontSize: 40, bold: true, color: C.white });
    sl.addText(trim(s.card?.summary || s.description, 220), { x: 0.8, y: 2.95, w: 10.5, h: 0.9, fontFace: FONT, fontSize: 15, color: 'C9D3E6', valign: 'top' });
    sl.addShape(pptx.ShapeType.roundRect, { x: 0.8, y: 4.1, w: 2.3, h: 0.5, fill: { color: hex(t.color) }, line: { color: hex(t.color) }, rectRadius: 0.25 });
    sl.addText(`${t.label} risk`, { x: 0.8, y: 4.1, w: 2.3, h: 0.5, fontFace: FONT, fontSize: 14, bold: true, color: C.white, align: 'center', valign: 'middle' });
    sl.addText(`Stage ${s.stage} of 10 · ${STAGES[s.stage - 1].name}`, { x: 3.3, y: 4.1, w: 7, h: 0.5, fontFace: FONT, fontSize: 14, color: C.white, valign: 'middle' });
    sl.addText([
      { text: `${client?.name ? `${client.name} · ` : ''}${s.code}${s.bu ? ` · ${s.bu}` : ''}${s.owner ? ` · Owner ${s.owner}` : ''}`, options: { breakLine: true } },
      { text: `Generated ${today} from GovernAI. Figures are computed from the product record, not written by AI.` },
    ], { x: 0.8, y: 5.6, w: 11, h: 0.8, fontFace: FONT, fontSize: 11, color: '9FB0CC' });
  }

  // 2. Executive summary
  {
    const sl = slide('Executive summary', `As of ${today}`);
    const open = s.actions.filter((x) => x.status !== 'Done');
    const overdue = open.filter((x) => x.due < new Date().toISOString().slice(0, 10)).length;
    const ctl = controlStatus(s, rules);
    const tiles = [
      [t.label, 'Risk tier', hex(t.color), r.legal?.tier !== 'minimal' ? `Legal floor ${TIERS[r.legal.tier].label}` : ''],
      [`${r.residual}`, 'Score after controls', tone(100 - r.residual), `of 100 · ${r.inherent} before controls`],
      [`${r.readiness}%`, 'Controls in place', tone(r.readiness), r.readinessStatus.label],
      [`${s.stage}/10`, 'Lifecycle stage', C.blue, STAGE_STATUS[s.stages?.[s.stage]?.status || 'open']],
      [`${open.length}`, 'Open actions', open.length ? C.warn : C.good, overdue ? `${overdue} overdue` : 'None overdue'],
      [`${ctl.filter((c) => c.status === 'Operating').length}/${ctl.length}`, 'Controls operating', C.ink, `AI card ${cardCompleteness(s)}% complete`],
    ];
    tiles.forEach((x, i) => tile(sl, 0.5 + i * 2.08, 1.3, 1.95, 1.35, x[0], x[1], x[2], x[3]));
    box(sl, 0.5, 2.9, 7.4, 3.95, 'Responsible AI principles: inherent risk and controls in place');
    sl.addChart(pptx.ChartType.bar, [
      { name: 'Inherent risk', labels: PRINCIPLE_IDS.map((k) => PRINCIPLES[k].short || PRINCIPLES[k].name), values: PRINCIPLE_IDS.map((k) => r.principles[k].risk) },
      { name: 'Controls in place %', labels: PRINCIPLE_IDS.map((k) => PRINCIPLES[k].short || PRINCIPLES[k].name), values: PRINCIPLE_IDS.map((k) => r.principles[k].readiness ?? 0) },
    ], { ...chartBase, x: 0.6, y: 3.3, w: 7.2, h: 3.45, barDir: 'bar', catAxisOrientation: 'maxMin', barGrouping: 'clustered', chartColors: [C.bad, C.blue], valAxisMaxVal: 100, valAxisMinVal: 0, showLegend: true, legendPos: 'b', showValue: true, dataLabelColor: C.ink });
    box(sl, 8.1, 2.9, 4.75, 3.95, 'Key messages');
    bullets(sl, keyMessages(s, rules), 8.3, 3.35, 4.4, 3.4, 12);
  }

  // 3. Risk and compliance
  {
    const sl = slide('Risk and compliance readiness', 'Where the score comes from and how ready each framework is');
    box(sl, 0.5, 1.25, 5.6, 5.6, 'Controls in place by principle');
    sl.addChart(pptx.ChartType.radar, [{ name: 'Controls in place %', labels: PRINCIPLE_IDS.map((k) => PRINCIPLES[k].short || PRINCIPLES[k].name), values: PRINCIPLE_IDS.map((k) => r.principles[k].readiness ?? 0) }],
      { ...chartBase, x: 0.6, y: 1.65, w: 5.4, h: 5.1, radarStyle: 'filled', chartColors: [C.blue], valAxisMaxVal: 100, valAxisMinVal: 0, showLegend: false });
    const fws = sectionOrder(a.frameworks);
    box(sl, 6.3, 1.25, 6.55, 2.95, 'Readiness by framework');
    sl.addChart(pptx.ChartType.bar, [{ name: 'Readiness %', labels: fws.map(sectionName), values: fws.map((k) => r.frameworks[k]?.score ?? 0) }],
      { ...chartBase, x: 6.4, y: 1.6, w: 6.35, h: 2.55, barDir: 'bar', catAxisOrientation: 'maxMin', chartColors: [C.cyan], valAxisMaxVal: 100, valAxisMinVal: 0, showValue: true, dataLabelColor: C.ink, showLegend: false });
    box(sl, 6.3, 4.35, 6.55, 2.5, 'Why this tier');
    bullets(sl, r.reasons.slice(0, 6).map((x) => trim(x, 150)), 6.5, 4.75, 6.2, 2.05, 10.5);
  }

  // 4. Responsible AI Compass
  {
    const sl = slide('Responsible AI Compass', 'Four directions and four cross-cutting principles, after Fractal\'s "Responsible AI by Design: Navigating with a Compass"');
    const { scores, phases } = compassScores(s);
    const cx = 3.4; const cy = 4.15; const R = 2.25;
    sl.addShape(pptx.ShapeType.ellipse, { x: cx - R, y: cy - R, w: 2 * R, h: 2 * R, fill: { color: C.bg }, line: { color: C.line, width: 1 } });
    sl.addShape(pptx.ShapeType.ellipse, { x: cx - R * 0.62, y: cy - R * 0.62, w: 2 * R * 0.62, h: 2 * R * 0.62, fill: { color: C.white }, line: { color: C.line, width: 0.75, dashType: 'dash' } });
    const pos = { N: [0, -1], NE: [0.71, -0.71], E: [1, 0], SE: [0.71, 0.71], S: [0, 1], SW: [-0.71, 0.71], W: [-1, 0], NW: [-0.71, -0.71] };
    for (const k of COMPASS_IDS) {
      const c = COMPASS[k]; const [dx, dy] = pos[c.dir]; const main = c.kind === 'direction';
      const rr = main ? R * 0.82 : R * 0.8; const bw = main ? 1.55 : 1.45; const bh = 0.62;
      const lw = Math.abs(dx * R * 0.6); const lh = Math.abs(dy * R * 0.6);
      sl.addShape(pptx.ShapeType.line, { x: dx < 0 ? cx - lw : cx, y: dy < 0 ? cy - lh : cy, w: lw || 0.001, h: lh || 0.001, flipH: (dx < 0) !== (dy < 0) && lw > 0 && lh > 0, line: { color: main ? C.blue : C.line, width: main ? 1.5 : 0.75 } });
      const x = cx + dx * rr - bw / 2; const y = cy + dy * rr - bh / 2;
      sl.addShape(pptx.ShapeType.roundRect, { x, y, w: bw, h: bh, fill: { color: pctFill(scores[k]) }, line: { color: main ? C.blue : C.line, width: main ? 1.25 : 0.75 }, rectRadius: 0.1 });
      sl.addText([{ text: c.name, options: { fontSize: main ? 11 : 9.5, bold: main, color: C.ink, breakLine: true } }, { text: scores[k] == null ? 'n/a' : `${scores[k]}`, options: { fontSize: main ? 14 : 12, bold: true, color: tone(scores[k]) } }],
        { x, y, w: bw, h: bh, fontFace: FONT, align: 'center', valign: 'middle', margin: 0 });
    }
    const vals = COMPASS_IDS.map((k) => scores[k]).filter((v) => v != null);
    const overall = vals.length ? Math.round(vals.reduce((x, y) => x + y, 0) / vals.length) : null;
    sl.addShape(pptx.ShapeType.ellipse, { x: cx - 0.55, y: cy - 0.55, w: 1.1, h: 1.1, fill: { color: C.navy }, line: { color: C.navy } });
    sl.addText([{ text: overall == null ? '—' : `${overall}`, options: { fontSize: 20, bold: true, color: C.white, breakLine: true } }, { text: 'overall', options: { fontSize: 8, color: 'C9D3E6' } }], { x: cx - 0.55, y: cy - 0.55, w: 1.1, h: 1.1, fontFace: FONT, align: 'center', valign: 'middle', margin: 0 });
    // Phase x direction heat table
    const head = [{ text: '', options: { fill: { color: C.white } } }, ...COMPASS_PHASES.map((p) => ({ text: p.name, options: { bold: true, color: C.ink, fill: { color: C.bg }, align: 'center' } }))];
    const rows = COMPASS_IDS.map((k) => [{ text: COMPASS[k].name, options: { bold: COMPASS[k].kind === 'direction', color: C.ink } },
      ...COMPASS_PHASES.map((p) => { const v = phases[p.id][k]; return { text: v == null ? '—' : `${v}%`, options: { align: 'center', color: v == null ? C.mute : C.ink, fill: { color: pctFill(v) } } }; })]);
    sl.addText('Checklist evidence by lifecycle phase', { x: 6.6, y: 1.3, w: 6.2, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: C.ink });
    sl.addTable([head, ...rows], { x: 6.6, y: 1.7, w: 6.25, colW: [1.85, 1.1, 1.1, 1.1, 1.1], fontFace: FONT, fontSize: 10, border: { type: 'solid', color: C.line, pt: 0.5 }, rowH: 0.36 });
    sl.addText('Score = share of checks done for that direction, blended with the assessment readiness of the matching principles. "—": no stage of that phase reached yet. Green 70+, amber 40 to 69, red below 40.',
      { x: 6.6, y: 5.15, w: 6.25, h: 0.7, fontFace: FONT, fontSize: 9.5, color: C.mute });
  }

  // 5. SWOT
  {
    const sl = slide('SWOT analysis', 'Computed from the assessment, lifecycle record, controls, actions and regulatory dates');
    const sw = swot(s, rules);
    const q = [['Strengths', sw.strengths, C.good, 'E8F3EC'], ['Weaknesses', sw.weaknesses, C.bad, 'FBE7E4'], ['Opportunities', sw.opportunities, C.blue, 'EEF0FD'], ['Threats', sw.threats, C.warn, 'FBF1DF']];
    q.forEach(([title, items, col, bg], i) => {
      const x = 0.5 + (i % 2) * 6.2; const y = 1.25 + Math.floor(i / 2) * 2.85;
      sl.addShape(pptx.ShapeType.roundRect, { x, y, w: 6.05, h: 2.7, fill: { color: bg }, line: { color: col, width: 1 }, rectRadius: 0.06 });
      sl.addShape(pptx.ShapeType.rect, { x, y: y + 0.15, w: 0.08, h: 0.4, fill: { color: col }, line: { color: col } });
      sl.addText(title, { x: x + 0.25, y: y + 0.12, w: 5, h: 0.45, fontFace: FONT, fontSize: 16, bold: true, color: col });
      bullets(sl, items.map((x2) => trim(x2, 140)), x + 0.25, y + 0.6, 5.65, 2.0, 11);
    });
  }

  // 6. Lifecycle
  {
    const sl = slide('Lifecycle progress', 'Ten stages from intake to retirement. Checks ticked, skipped with a reason, or still open.');
    STAGES.forEach((st, i) => {
      const rec = s.stages?.[st.n]; const cur = st.n === s.stage;
      const col = rec?.status === 'approved' ? C.good : cur ? (rec?.status === 'returned' ? C.warn : C.blue) : 'C5CCD8';
      const x = 0.55 + i * 1.24;
      if (i < 9) sl.addShape(pptx.ShapeType.line, { x: x + 0.5, y: 1.62, w: 0.74, h: 0, line: { color: rec?.status === 'approved' ? C.good : C.line, width: 2 } });
      sl.addShape(pptx.ShapeType.ellipse, { x: x + 0.1, y: 1.32, w: 0.6, h: 0.6, fill: { color: rec ? col : C.white }, line: { color: col, width: 1.5 } });
      sl.addText(`${st.n}`, { x: x + 0.1, y: 1.32, w: 0.6, h: 0.6, fontFace: FONT, fontSize: 13, bold: true, color: rec ? C.white : C.mute, align: 'center', valign: 'middle', margin: 0 });
      sl.addText(st.short, { x: x - 0.2, y: 1.95, w: 1.2, h: 0.4, fontFace: FONT, fontSize: 9, color: cur ? C.ink : C.mute, bold: cur, align: 'center' });
    });
    const by = checklistByStage(s);
    box(sl, 0.5, 2.55, 7.3, 4.3, 'Checklist by stage reached');
    if (by.length) {
      sl.addChart(pptx.ChartType.bar, [
        { name: 'Ticked', labels: by.map((x) => `${x.n}. ${x.name}`), values: by.map((x) => x.done) },
        { name: 'Skipped with reason', labels: by.map((x) => `${x.n}. ${x.name}`), values: by.map((x) => x.skipped) },
        { name: 'Open', labels: by.map((x) => `${x.n}. ${x.name}`), values: by.map((x) => x.open) },
      ], { ...chartBase, x: 0.6, y: 2.95, w: 7.1, h: 3.8, barDir: 'bar', catAxisOrientation: 'maxMin', barGrouping: 'stacked', chartColors: [C.good, C.warn, 'C5CCD8'], showLegend: true, legendPos: 'b' });
    }
    box(sl, 8.0, 2.55, 4.85, 4.3, 'Skipped checks and reasons');
    const skips = by.flatMap((x) => x.skips.map((k) => `Stage ${x.n}: ${trim(k.item, 70)} Reason: ${trim(k.reason, 90)}`));
    bullets(sl, skips.length ? skips.slice(0, 6) : ['No checks skipped. Every completed check was ticked.'], 8.2, 2.95, 4.5, 3.8, 10);
  }

  // 7. Controls and actions
  {
    const sl = slide('Controls and actions', 'Controls are evidenced by lifecycle checks; actions come from gaps, skipped checks and "Not known" answers');
    const acts = s.actions || [];
    const st = ['Open', 'In progress', 'Done'].map((k) => acts.filter((x) => x.status === k).length);
    box(sl, 0.5, 1.25, 4.0, 3.0, 'Actions by status');
    if (acts.length) sl.addChart(pptx.ChartType.doughnut, [{ name: 'Actions', labels: ['Open', 'In progress', 'Done'], values: st }], { ...chartBase, x: 0.6, y: 1.6, w: 3.8, h: 2.6, holeSize: 58, chartColors: [C.bad, C.warn, C.good], showLegend: true, legendPos: 'r', showPercent: false, showValue: true, dataLabelColor: C.white });
    box(sl, 4.7, 1.25, 4.0, 3.0, 'Open actions by priority');
    const pr = ['High', 'Medium', 'Low'].map((k) => acts.filter((x) => x.status !== 'Done' && x.priority === k).length);
    sl.addChart(pptx.ChartType.bar, [{ name: 'Open', labels: ['High', 'Medium', 'Low'], values: pr }], { ...chartBase, x: 4.8, y: 1.6, w: 3.8, h: 2.6, barDir: 'col', chartColors: [C.bad, C.warn, C.ok], showValue: true, showLegend: false, dataLabelColor: C.ink });
    const ctl = controlStatus(s, rules);
    box(sl, 8.9, 1.25, 3.95, 3.0, 'Control status');
    const cs = ['Operating', 'In progress', 'Partial', 'Gap'].map((k) => ctl.filter((c) => c.status === k).length);
    sl.addChart(pptx.ChartType.bar, [{ name: 'Controls', labels: ['Operating', 'In progress', 'Partial', 'Gap'], values: cs }], { ...chartBase, x: 9.0, y: 1.6, w: 3.75, h: 2.6, barDir: 'col', chartColors: [C.good, C.ok, C.warn, C.bad], showValue: true, showLegend: false, dataLabelColor: C.ink });
    const top = acts.filter((x) => x.status !== 'Done').sort((x, y) => ['High', 'Medium', 'Low'].indexOf(x.priority) - ['High', 'Medium', 'Low'].indexOf(y.priority) || String(x.due).localeCompare(String(y.due))).slice(0, 7);
    const hdr = ['Priority', 'Action', 'Owner', 'Due', 'Status'].map((h) => ({ text: h, options: { bold: true, color: C.mute, fill: { color: C.bg } } }));
    sl.addTable([hdr, ...(top.length ? top.map((x) => [{ text: x.priority, options: { color: x.priority === 'High' ? C.bad : x.priority === 'Medium' ? C.warn : C.ok, bold: true } }, trim(`${x.topic}: ${x.action}`, 120), x.owner || 'Unassigned', x.due, x.status]) : [['', 'No open actions', '', '', '']])],
      { x: 0.5, y: 4.45, w: 12.35, colW: [0.9, 7.6, 1.6, 1.15, 1.1], fontFace: FONT, fontSize: 9.5, color: C.ink, border: { type: 'solid', color: C.line, pt: 0.5 }, rowH: 0.3 });
  }

  // 8. Questionnaire
  {
    const sl = slide('Assessment answers', `${a.questions.length} questions: ${r.fixedCount} standard, ${r.adaptiveCount} tailored (${a.questionSource})`);
    const mix = answerMix(s);
    const keys = ['Not in place', 'Started', 'In place', 'Evidenced', 'Not known', 'Not applicable'];
    box(sl, 0.5, 1.25, 8.0, 5.6, 'Answers by framework');
    sl.addChart(pptx.ChartType.bar, keys.map((k) => ({ name: k, labels: mix.map((m) => m.name), values: mix.map((m) => m[k]) })),
      { ...chartBase, x: 0.6, y: 1.65, w: 7.8, h: 5.1, barDir: 'bar', catAxisOrientation: 'maxMin', barGrouping: 'stacked', chartColors: [C.bad, C.warn, C.ok, C.good, 'F5B544', 'C5CCD8'], showLegend: true, legendPos: 'b' });
    box(sl, 8.7, 1.25, 4.15, 5.6, 'Data governance maturity');
    const pill = Object.entries(PILLARS).map(([k, p]) => [p.short, r.pillars[k]]);
    pill.forEach(([name, v], i) => {
      const y = 1.75 + i * 0.55;
      sl.addText(name, { x: 8.9, y, w: 1.3, h: 0.35, fontFace: FONT, fontSize: 10.5, color: C.ink });
      sl.addShape(pptx.ShapeType.roundRect, { x: 10.2, y: y + 0.09, w: 1.9, h: 0.18, fill: { color: 'E6EAF0' }, line: { color: 'E6EAF0' }, rectRadius: 0.09 });
      if (v.score) sl.addShape(pptx.ShapeType.roundRect, { x: 10.2, y: y + 0.09, w: Math.max(0.05, 1.9 * (v.score / 100)), h: 0.18, fill: { color: tone(v.score) }, line: { color: tone(v.score) }, rectRadius: 0.09 });
      sl.addText(v.score == null ? '—' : `${v.score}`, { x: 12.15, y, w: 0.6, h: 0.35, fontFace: FONT, fontSize: 10.5, bold: true, color: tone(v.score), align: 'right' });
    });
    const unk = a.questions.filter((q) => a.answers[q.id] === 'unknown');
    sl.addText(unk.length ? `"Not known" (scored as not in place): ${unk.slice(0, 4).map((q) => q.topic).join(', ')}${unk.length > 4 ? ` and ${unk.length - 4} more` : ''}` : 'No answers given as "Not known".',
      { x: 8.9, y: 5.2, w: 3.8, h: 1.4, fontFace: FONT, fontSize: 10, color: C.mute, valign: 'top' });
  }

  // 9. Data and lineage
  {
    const sl = slide('Data and lineage', 'Datasets feeding the AI product and how well they are governed');
    const ds = s.datasets || []; const pct = (k) => (ds.length ? Math.round((ds.filter((d) => (k === 'steward' ? d.steward : d[k])).length / ds.length) * 100) : 0);
    box(sl, 0.5, 1.25, 4.6, 3.2, 'Coverage');
    sl.addChart(pptx.ChartType.bar, [{ name: 'Coverage %', labels: ['In catalog', 'Lineage', 'Steward', 'Quality rules'], values: [pct('catalogued'), pct('lineage'), pct('steward'), pct('qualityChecked')] }],
      { ...chartBase, x: 0.6, y: 1.6, w: 4.4, h: 2.8, barDir: 'col', chartColors: [C.cyan], valAxisMaxVal: 100, valAxisMinVal: 0, showValue: true, showLegend: false, dataLabelColor: C.ink });
    const yes = (v) => ({ text: v ? 'Yes' : 'No', options: { color: v ? C.good : C.bad, bold: true, align: 'center' } });
    const hdr = ['Dataset', 'Used as', 'Class', 'Steward', 'Catalog', 'Lineage', 'Quality'].map((h) => ({ text: h, options: { bold: true, color: C.mute, fill: { color: C.bg } } }));
    sl.addTable([hdr, ...(ds.length ? ds.slice(0, 9).map((d) => [trim(d.name, 34), d.role, d.classification, d.steward || 'None', yes(d.catalogued), yes(d.lineage), yes(d.qualityChecked)]) : [['No datasets registered', '', '', '', '', '', '']])],
      { x: 5.3, y: 1.25, w: 7.55, colW: [2.0, 1.25, 1.05, 1.0, 0.75, 0.75, 0.75], fontFace: FONT, fontSize: 9.5, color: C.ink, border: { type: 'solid', color: C.line, pt: 0.5 }, rowH: 0.32 });
    sl.addText(`Outputs go to: ${(s.outputs || []).join(', ') || 'not recorded'}`, { x: 0.5, y: 4.7, w: 12, h: 0.4, fontFace: FONT, fontSize: 11, color: C.ink });
  }

  // 10. Regulatory dates, sign-offs, card
  {
    const sl = slide('Regulatory dates, sign-offs and AI card', `AI card: ${cardStatus(s).label}, ${cardCompleteness(s)}% complete, version ${s.card?.version || 1}`);
    const dl = deadlinesFor(s);
    const hdr = (cols) => cols.map((h) => ({ text: h, options: { bold: true, color: C.mute, fill: { color: C.bg } } }));
    sl.addText('Dates that apply', { x: 0.5, y: 1.25, w: 6, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: C.ink });
    sl.addTable([hdr(['Date', 'Obligation', 'When']), ...(dl.length ? dl.map((d) => [d.date, trim(d.title, 60), { text: d.days < 0 ? `${-d.days} days ago` : `in ${d.days} days`, options: { color: d.days <= 90 ? C.bad : C.ink, bold: d.days <= 90 } }]) : [['', 'No dated obligation applies to the frameworks chosen', '']])],
      { x: 0.5, y: 1.65, w: 6.0, colW: [1.1, 3.6, 1.3], fontFace: FONT, fontSize: 10, color: C.ink, border: { type: 'solid', color: C.line, pt: 0.5 }, rowH: 0.32 });
    const sign = STAGES.filter((st) => s.stages?.[st.n]?.approvals && Object.keys(s.stages[st.n].approvals).length).flatMap((st) => Object.entries(s.stages[st.n].approvals).map(([k, v]) => [`${st.n}. ${st.short}`, ROLES[k]?.name || k, v.outcome, v.at ? v.at.slice(0, 10) : '']));
    sl.addText('Sign-offs', { x: 6.8, y: 1.25, w: 6, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: C.ink });
    sl.addTable([hdr(['Stage', 'By', 'Decision', 'Date']), ...(sign.length ? sign.slice(-10) : [['', 'No sign-offs yet', '', '']])],
      { x: 6.8, y: 1.65, w: 6.05, colW: [1.5, 1.9, 1.6, 1.05], fontFace: FONT, fontSize: 10, color: C.ink, border: { type: 'solid', color: C.line, pt: 0.5 }, rowH: 0.3 });
    const c = s.card || {};
    sl.addText([{ text: 'Intended use: ', options: { bold: true } }, { text: trim(c.intendedUse || 'not documented', 200), options: { breakLine: true } },
      { text: 'Known limitations: ', options: { bold: true } }, { text: trim(c.limitations || 'not documented', 200), options: { breakLine: true } },
      { text: 'Human oversight: ', options: { bold: true } }, { text: trim(c.oversight || 'not documented', 200) }],
    { x: 0.5, y: 5.05, w: 12.35, h: 1.8, fontFace: FONT, fontSize: 10.5, color: C.ink, valign: 'top', paraSpaceAfter: 4 });
  }

  // 11. Method
  {
    const sl = slide('How the figures are calculated');
    const w = whatIf(s);
    bullets(sl, [
      'Inherent risk: the six Responsible AI principles, rated from the risk profile and weighted. "Not known" answers take the highest rating.',
      'Controls in place: weighted average of control answers (Not in place 0, Started 35, In place 70, Evidenced 100). "Not known" scores 0.',
      `Score after controls = inherent x (1 - 0.35 x readiness). Today ${w.now}; ${w.started} "Started" controls moved to "In place" would give ${w.afterStarted}.`,
      'Tier: the strictest of the legal floor, the score band (cut-offs of the frameworks in scope) and the severe-principle floor.',
      'Compass: share of lifecycle checks done for each direction, blended with the readiness of the matching principles.',
      'SWOT: rules over the same data. Nothing in this deck is written by an AI model, and no data left the browser to build it.',
      `Audit trail: ${audit.length} recorded events for this product, available in the full audit report.`,
      'Indicative assessment, not legal advice.',
    ], 0.5, 1.2, 12.3, 5.6, 13);
  }

  return pptx;
}

export async function downloadDeck(s, opts = {}) {
  const pptx = await buildDeck(s, opts);
  await pptx.writeFile({ fileName: `${s.code}-${s.name.replace(/[^A-Za-z0-9]+/g, '-')}-dashboard.pptx` });
}
