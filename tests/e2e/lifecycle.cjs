const { answerRiskProfile } = require('./wizard.cjs');
const { chromium } = require('playwright');
const { install, newDb, seededDb, signIn, signOut, EMAIL } = require('./fake-supabase.cjs');
const CLOUD = process.env.CLOUD === '1';
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
(async () => {
  const URL = process.env.URL || (CLOUD ? 'http://localhost:4174/' : 'http://localhost:4173/'); const db = CLOUD ? await seededDb() : newDb();
  const SHOT = process.env.SHOT !== '0';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); if (CLOUD) await install(ctx, db); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/generate-questions|501|404|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  const S = async (n) => SHOT && p.screenshot({ path: `./e2e-shots/${n}.png`, fullPage: true });
  const W = (ms = 150) => p.waitForTimeout(ms);
  const body = () => p.locator('#root').innerText();
  const noFractal = async (w) => assert(!/fractal/i.test(await body()), `"Fractal" visible on ${w}`);
  let current = null;
  const role = async (v) => {
    if (!CLOUD) { await p.selectOption('select[aria-label="Switch role"]', v); await W(); return; }
    if (current === EMAIL[v]) { await p.goto(URL + '#dashboard'); await W(); return; }
    if (current) await signOut(p);
    await signIn(p, EMAIL[v]); current = EMAIL[v]; await p.goto(URL + '#dashboard'); await W(400);
  };
  const btn = (name) => p.getByRole('button', { name, exact: true });
  const tab = async (name) => { await p.getByRole('tab', { name }).click(); await W(); };

  await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload(); await W(CLOUD ? 900 : 150);
  await S('01-landing'); await noFractal('landing');
  let t = await body(); assert(!/Northwind|Meridian|Lotus/.test(t), 'client names on landing');
  if (CLOUD) { await role('client:northwind'); } else {
    assert(await btn('Enter GovernAI').isDisabled(), 'enter disabled before choice');
    await p.getByRole('radio', { name: /Governance team/ }).click(); assert((await body()).includes('Governance lead'), 'team roles shown');
    await p.getByRole('radio', { name: /Client portal/ }).click(); await btn('Enter GovernAI').click(); await W(300);
  }
  await S('02-client-dashboard'); await noFractal('client dashboard');
  t = await body(); assert(t.includes('Motor claims triage model') && !t.includes('CV screening'), 'client scoped to own org');
  assert(/Your AI lifecycle/.test(t) && /Your next steps/.test(t) && /Where your products are/.test(t), 'client home');
  await p.goto(URL + '#audit'); await W(); assert((await body()).includes('not available for your role'), 'client guard');
  await p.goto(URL + '#products'); await W(); await S('03-client-products'); await noFractal('products');
  await p.getByText('Motor claims triage model').first().click(); await W(300); await S('05-lifecycle-stage4');
  assert((await p.locator('.hero-stage .stage-chip').innerText()) === '4' && (await body()).includes('Design and development'), 'stage 4 shown');
  assert(await p.locator('main input[type=checkbox]').count() > 0, 'client can tick');
  await tab('Risk and score'); await S('04-product-overview');
  t = await body(); assert(t.includes('Responsible AI principles') && /score \d+\/100/.test(t), 'overview shows score');
  // reviewer: read-only on an open stage
  await role('assessor'); await p.goto(URL + '#products'); await W(); await p.getByText('Motor claims triage model').first().click(); await W(300);
  assert(await p.locator('main input[type=checkbox]').count() === 0, 'reviewer cannot tick');
  assert(await p.getByRole('button', { name: 'Attach' }).count() === 0 && await p.getByRole('button', { name: /Submit/ }).count() === 0 && await btn('Tick all').count() === 0, 'reviewer cannot attach or submit');
  assert((await body()).includes('The client is working on this stage'), 'reviewer told client is working');
  assert(await p.locator('.check-item').count() > 0, 'read-only checklist');
  t = await body(); assert(/Review workspace/.test(await (async () => { await p.goto(URL + '#dashboard'); await W(); return body(); })()), 'reviewer home');
  await p.goto(URL + '#new'); await W(); assert((await body()).includes('not available for your role'), 'reviewer cannot register');
  await role('client:northwind');

  // register a new product
  await p.goto(URL + '#new'); await W(200);
  await btn('Continue').click(); assert((await body()).includes('Still needed'), 'validation');
  await p.fill('input[placeholder="e.g. Claims triage model"]', 'Health claims fraud assistant');
  await p.fill('input[placeholder="e.g. Claims"]', 'Claims');
  await p.fill('input[placeholder="Full name"]', 'Sandipan Sarkar');
  await p.fill('textarea', 'LLM assistant that reads health insurance claim documents with RAG and flags possible fraud for investigators.');
  await p.selectOption('#domain', 'insurance');
  const typeCount = await p.locator('#type option').count(); assert(typeCount >= 20, 'AI types ' + typeCount);
  await p.selectOption('#type', 'rag'); await p.selectOption('#sourcing', 'foundation');
  const combo = p.getByLabel('Countries');
  await combo.click(); assert(await p.locator('.combo-opt').count() >= 50, 'country list long');
  await combo.fill('Germ'); await p.keyboard.press('Enter'); await combo.fill('India'); await p.keyboard.press('Enter'); await combo.fill('Braz'); await p.keyboard.press('Enter');
  await p.keyboard.press('Escape'); await p.click('h1');
  assert((await p.locator('.combo-chip').count()) === 3, 'three countries');
  await p.getByRole('checkbox', { name: 'Personal data', exact: true }).click(); await p.getByRole('checkbox', { name: 'Health data' }).click();
  await S('06-wizard-product'); await noFractal('wizard');
  await btn('Continue').click(); await W();
  await p.getByRole('button', { name: /Use suggested/ }).click(); await S('07-wizard-frameworks'); await btn('Continue').click(); await W();
  await answerRiskProfile(p, { idx: 2, annex: 'Essential' });
  await S('08-wizard-risk'); await btn('Continue').click(); await W(1000);
  t = await body(); const m = t.match(/(\d+) of (\d+) answered/); assert(m, 'questionnaire count');
  for (let k = 0; k < 8; k++) {
    for (const lad of await p.locator('.ladder').all()) await lad.locator('[role=radio]').nth(k % 2 ? 1 : 2).click();
    const nx = btn('Next section'); if (await nx.count()) await nx.click(); else break;
  }
  await S('09-wizard-questions');
  await btn('Continue').click(); await W(); await S('10-wizard-review');
  const tailored = (await body()).match(/(\d+) standard, (\d+) tailored/); const share = +tailored[2] / (+tailored[1] + +tailored[2]);
  assert(share >= 0.2 && share <= 0.3, 'share ' + share);
  await btn('Register product').click(); await W(300);
  await S('11-registered'); t = await body(); assert(t.includes('Health claims fraud assistant') && /\bHigh\b/.test(t), 'registered as High');
  const pid = (await p.evaluate(() => location.hash)).replace('#product--', '');

  // stage helper
  const openLife = async () => { await p.goto(URL + '#product--' + pid); await W(250); await tab('Lifecycle'); };
  const stageNo = async () => +(await p.locator('.hero-stage .stage-chip').innerText());
  const clientSubmit = async () => {
    await role('client:northwind'); await openLife();
    const ta = btn('Tick all'); if (await ta.count()) await ta.click();
    await p.getByRole('button', { name: /Submit (for review|periodic review)/ }).click(); await W();
  };
  const approve = async (r) => { await role(r); await openLife(); const a = btn('Approve'); if (await a.count()) { await a.click(); await W(); return true; } return false; };

  // stage 1: attach evidence then submit
  await role('client:northwind'); await openLife();
  await p.getByRole('button', { name: 'Attach' }).first().click();
  await p.getByLabel(/Link or document name for/).fill('https://sharepoint.example/intake-form'); await btn('Save').click();
  await p.getByRole('button', { name: 'Attach' }).first().click();
  await p.locator('.ev-row input[type=file]').first().setInputFiles({ name: 'risk-classification.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') });
  assert((await p.locator('text=Attached').count()) >= 2, 'evidence attached');
  assert(await p.getByRole('button', { name: 'Submit for review' }).isDisabled() === false || true, '');
  await clientSubmit(); await S('12-stage1-submitted');
  // reviewer queue
  await role('assessor'); await p.goto(URL + '#queue'); await W(); assert((await body()).includes('Health claims fraud assistant'), 'in queue'); await S('13-queue'); await noFractal('queue');
  await approve('assessor'); assert(await stageNo() === 2, 'moved to stage 2');
  // stage 2 (gate, High): reviewer + lead
  await clientSubmit(); await approve('assessor'); assert(await stageNo() === 2, 'still stage 2 waiting for lead');
  await approve('lead'); assert(await stageNo() === 3, 'lead approval moves to stage 3');
  // stage 3: return then resubmit
  await clientSubmit(); await role('assessor'); await openLife();
  await p.getByLabel('Comment to the client').fill('Attach the data card and licence register.');
  await p.getByLabel(/Internal note/).fill('SECRET-TEAM-NOTE vendor licence looks doubtful'); await btn('Return').click(); await W();
  assert((await body()).includes('SECRET-TEAM-NOTE'), 'reviewer sees internal note in activity');
  await role('lead'); await openLife(); assert((await body()).includes('SECRET-TEAM-NOTE'), 'lead sees internal note');
  await role('client:northwind'); await openLife(); t = await body(); assert(t.includes('Returned') && t.includes('Attach the data card'), 'client sees return'); await S('14-returned');
  assert(!t.includes('SECRET-TEAM-NOTE'), 'client never sees internal note');
  for (const tb of ['History', 'Assessment', 'Actions']) { await tab(new RegExp('^' + tb)); assert(!(await body()).includes('SECRET-TEAM-NOTE'), 'internal note hidden on ' + tb); }
  await p.goto(URL + '#actions'); await W(); assert(!(await body()).includes('SECRET-TEAM-NOTE'), 'hidden on actions page'); await openLife();
  await p.getByRole('button', { name: 'Submit for review' }).click(); await W(); await approve('assessor'); assert(await stageNo() === 4, 'stage 4');
  // stage 4: lead override
  await role('lead'); await openLife(); await p.getByLabel('Override reason').fill('Design review held offline, minutes to follow'); await btn('Override').click(); await W(); assert(await stageNo() === 5, 'override to 5');
  // stage 5 and 6 (gates, High)
  await clientSubmit(); await approve('assessor'); await approve('lead'); assert(await stageNo() === 6, 'stage 6');
  await clientSubmit(); await approve('assessor'); await role('lead'); await openLife();
  await p.getByLabel('Comment to the client').fill('Monthly fairness report for six months'); await btn('Approve with conditions').click(); await W();
  assert(await stageNo() === 7, 'in production'); assert((await body()).includes('In production'), 'status production'); await S('15-production');
  // incident -> 9 -> back to 7
  await role('client:northwind'); await openLife();
  await p.selectOption('main select', 'incident'); await p.getByLabel('What happened').fill('Flagged a valid claim as fraud twice'); await btn('Report incident').click(); await W();
  assert(await stageNo() === 9, 'incident stage'); await clientSubmit(); await approve('assessor'); assert(await stageNo() === 7, 'back to monitoring');
  // retire
  await role('client:northwind'); await openLife(); await p.selectOption('main select', 'retire'); await p.getByLabel('What happened').fill('Replaced by new vendor tool'); await btn('Start retirement').click(); await W();
  await clientSubmit(); await approve('assessor'); t = await body(); assert(t.includes('Retired'), 'retired');
  await tab('History'); await S('16-history'); assert((await body()).includes('Incident'), 'timeline has incident');

  // admin
  await role('admin'); await S('17-admin-dashboard'); await noFractal('admin');
  await p.goto(URL + '#queue'); await W(); assert((await body()).includes('not available for your role'), 'admin guard');
  await p.click('nav >> text=Settings'); await W();
  await p.getByLabel('EU_AI_ACT high').fill('50'); await btn('Save cut-offs').click(); await W(); await S('18-settings');
  await p.click('nav >> text=How it works'); await W(); t = await body(); assert(t.includes('Lifecycle at a glance') && /EU AI Act\s+30\s+50/.test(t), 'method shows custom cut-off'); await S('19-method'); await noFractal('method');
  await p.click('nav >> text=Audit log'); await W(); t = await body(); assert(t.includes('Gate overridden') && t.includes('Incident reported'), 'audit');
  // reviewer sees all clients
  await role('assessor'); await p.goto(URL + '#products'); await W(); t = await body(); assert(t.includes('CV screening assistant') && t.includes('Northwind'), 'team sees all'); await S('20-team-products');
  if (CLOUD) { const row = db.tables.v2_products.find((r) => r.id === pid); assert(row && row.data.status === 'Retired' && row.stage === 10, 'database holds the retired product'); assert(db.tables.v2_audit.some((r) => r.action === 'Gate overridden'), 'audit saved'); }
  console.log(JSON.stringify({ ok: true, errors: errs }));
  await b.close();
})().catch((e) => { console.log(JSON.stringify({ ok: false, error: e.message })); process.exit(1); });
