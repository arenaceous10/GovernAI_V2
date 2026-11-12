// Governance hardening on the screens: legal position law by law, the EU role and Annex I questions, incident
// severity with reporting clocks, suspended control credit, the single cut-off scale and what the reviewer is shown.
// Browser-only demo build on port 4173:  npm run build && node tests/e2e/serve-with-headers.cjs dist 4173 &
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
(async () => {
  const URL = process.env.URL || 'http://localhost:4173/';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/generate-questions|501|404|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  const W = (ms = 200) => p.waitForTimeout(ms);
  const body = () => p.locator('#root').innerText();
  const role = async (v) => { await p.selectOption('select[aria-label="Switch role"]', v); await W(); };
  const tab = async (name) => { await p.getByRole('tab', { name }).click(); await W(); };
  const btn = (name) => p.getByRole('button', { name, exact: true });
  try {
    await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload(); await W();
    await p.getByRole('radio', { name: /Client portal/ }).click(); await btn('Enter GovernAI').click(); await W(300);

    // 1. results: the legal position is shown law by law, and a tier set by law says so
    await role('lead'); await p.goto(URL + '#product--sys-2'); await W(300); await tab('Risk and score');
    let t = await body();
    assert(/Legal position, law by law/.test(t), 'legal panel shown');
    assert(/High-risk/.test(t) && /Provider and deployer/.test(t), 'EU AI Act category and role');
    assert(/DPIA required/.test(t) && /Art\. 9 condition needed/.test(t), 'GDPR position');
    assert(/Check Significant Data Fiduciary status/.test(t), 'DPDP position');
    assert(/Credit towards the score/.test(t), 'credit per principle shown');

    // 2. a product with an open incident: control credit is suspended, on the result and on the stage
    await p.goto(URL + '#product--sys-7'); await W(300); await tab('Risk and score'); t = await body();
    assert(/Control credit suspended/.test(t) && /An incident is open/.test(t), 'suspension explained on the result');
    await tab('Lifecycle'); t = await body();
    assert(/The approved picture no longer holds/.test(t), 'signal shown on the stage');

    // 3. raising an incident asks for severity and shows the reporting clocks before and after
    await role('client:meridian'); await p.goto(URL + '#product--sys-5'); await W(300); await tab('Lifecycle');
    await p.selectOption('main select', 'incident'); await p.getByLabel('What happened').fill('Assistant gave customers the wrong refund terms');
    await p.getByLabel('Incident severity').selectOption('serious'); await p.getByLabel('Kind of serious incident').selectOption('general');
    await p.getByText('Personal data was exposed, lost or wrongly changed').click(); await W();
    t = await body(); assert(/Reporting clocks that will start/.test(t) && /GDPR Art\. 33-34 \(72 hours\)/.test(t), 'clocks previewed');
    assert(!/EU AI Act Art\. 73/.test(t), 'Art. 73 is not shown for a system that is not high-risk');
    await btn('Report incident').click(); await W(400); t = await body();
    assert(/Incident recorded/.test(t) && /Serious, personal data affected/.test(t) && /GDPR Art\. 33-34:/.test(t), 'clocks shown on the incident stage');
    assert(/Control credit in the risk score is suspended/.test(t), 'credit suspended while the incident is open');

    // 4. checklist: mandatory checks cannot be bulk-ticked
    await role('client:northwind'); await p.goto(URL + '#product--sys-1'); await W(300); await tab('Lifecycle');
    const bulk = p.getByRole('button', { name: /Tick the \d+ optional checks/ });
    assert(await p.getByRole('button', { name: 'Tick all', exact: true }).count() === 0, 'no "Tick all"');
    if (await bulk.count()) { await bulk.click(); await W(); }
    assert(await p.locator('.check-item input[type=checkbox]:not(:checked)').count() > 0, 'mandatory checks left to tick one by one');
    assert(/mandatory check/.test(await body()), 'blocker names the mandatory checks');

    // 5. registration: Annex I and the EU role are asked when the EU AI Act is in scope
    await p.goto(URL + '#reassess--sys-2'); await W(400);
    for (let k = 0; k < 2; k++) { await btn('Continue').click().catch(() => {}); await W(300); }
    t = await body();
    if (/Regulatory screening/.test(t)) {
      assert(/regulated product, or a safety component of one \(Annex I\)/.test(t), 'Annex I asked');
      assert(/What is your role for this system under the EU AI Act/.test(t), 'EU role asked');
      assert(/emergency healthcare patient triage/.test(t), 'Annex III names emergency healthcare triage');
    } else throw new Error('ASSERT: did not reach the risk profile step: ' + t.slice(0, 200));

    // 6. one cut-off scale, in settings and on the method page
    await role('admin'); await p.goto(URL + '#settings'); await W(300); t = await body();
    assert(/Every product \(current scoring\)/.test(t) && /earlier assessments only/.test(t), 'single scale in settings');
    assert(await p.getByLabel('SCALE limited').inputValue() === '40' && await p.getByLabel('SCALE high').inputValue() === '65', 'default scale 40 / 65');
    await p.goto(URL + '#method'); await W(300); t = await body();
    assert(/Stakes floor/.test(t) && /40% its worst item/.test(t) && /Reviewer; lead too if High/.test(t), 'method page explains the scoring');

    // 7. the reviewer's decision panel carries the new hints
    await role('assessor'); await p.goto(URL + '#product--sys-3'); await W(300); await tab('Lifecycle'); t = await body();
    assert(/Your decision/.test(t) && /A condition becomes a high-priority action/.test(t), 'reviewer told what a condition does');

    // 8. registry panel: an approved version clears the "new version" alert; positive-class figures, groups and the
    //    comparison with the AI card are shown. The connector state is planted in the browser's own storage.
    await p.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('governai.v4'));
      const x = st.systems.find((y) => y.id === 'sys-3');
      x.stage = 7; x.status = 'In production'; x.stages[6] = { ...x.stages[6], status: 'approved', approvedAt: '2026-10-01T00:00:00.000Z' }; x.stages[7] = { status: 'open', checklist: {}, evidence: {}, approvals: {}, note: '' };
      x.card = { ...(x.card || {}), modelVersion: '2', metrics: [{ name: 'Recall', value: '0.90' }] };
      x.approvedVersions = [{ version: '2', at: '2026-11-01T00:00:00.000Z', stage: 8, source: 'registry' }];
      x.connector = { kind: 'databricks-uc', host: 'https://dbc.example.com', model: 'w.d.fraud', monitorTable: 'w.d.inf', warehouseId: 'abcdef1234567890', latest: '3', seenVersion: '3', lastSync: '2026-11-12T08:00:00.000Z',
        versions: [{ version: '3', metrics: {} }, { version: '2', metrics: {} }],
        alerts: [{ at: '2026-10-20T00:00:00.000Z', version: '2', from: '1', raised: true }, { at: '2026-11-11T00:00:00.000Z', version: '3', from: '2', raised: false }],
        monitoring: { table: 'w.d.inf', monitor: { status: 'ACTIVE' }, notes: [],
          drift: { windowEnd: '2026-11-11T00:00:00Z', checked: 4, drifted: [{ column: 'heart_rate', js: 0.42, psi: 0.5, ksP: 0.001 }], skipped: ['encounter_id', 'label'] },
          performance: { windowEnd: '2026-11-11T00:00:00Z', rows: 2000, positiveLabel: '1', metrics: { accuracy_score: 0.9, recall: 0.92, recall_positive: 0.62, precision_positive: 0.7 },
            slices: [{ key: 'sex', value: 'F', rows: 900, metrics: { recall_positive: 0.5, accuracy_score: 0.88 } }, { key: 'sex', value: 'M', rows: 1100, metrics: { recall_positive: 0.72, accuracy_score: 0.92 } }] } } };
      localStorage.setItem('governai.v4', JSON.stringify(st));
    });
    await p.reload(); await W(400); await role('lead'); await p.goto(URL + '#card--sys-3'); await W(500); t = await body();
    assert(/Approved version/.test(t), 'approved version shown');
    assert(/Version 3 found/.test(t) && !/Version 2 found/.test(t), 'the alert for the approved version has cleared; the newer one stays');
    assert(/recall, positive class \(1\)/i.test(t) && /recall, weighted/i.test(t), 'positive-class and weighted figures labelled');
    assert(/1 live metric is more than 5 points below the value on the AI card/.test(t), 'live recall compared with the AI card');
    assert(/sex: F/.test(t) && /By group, latest window/.test(t), 'figures by group');
    assert(/Left out of the drift check/.test(t) && /encounter_id/.test(t), 'columns left out of drift are named');
    await p.goto(URL + '#product--sys-3'); await W(300); await tab('Lifecycle'); t = await body();
    assert(/Model version 3 is in the registry but not yet approved/.test(t), 'unapproved version is a breach signal');

    console.log(JSON.stringify({ ok: errs.length === 0, errors: errs }));
    process.exitCode = errs.length ? 1 : 0;
  } catch (e) { console.log(JSON.stringify({ ok: false, error: e.message.slice(0, 600), errors: errs })); process.exitCode = 1; }
  await b.close();
})();
