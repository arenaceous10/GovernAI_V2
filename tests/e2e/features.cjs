// Checklist rules and skips, controls and actions, AI cards, dashboard deck, insights and what the AI receives.
// Cloud build on port 4174 against the Supabase stand-in.
const { chromium } = require('playwright');
const { install, seededDb, signIn, signOut, EMAIL } = require('./fake-supabase.cjs');
const { answerRiskProfile } = require('./wizard.cjs');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
(async () => {
  const URL = process.env.URL || 'http://localhost:4174/';
  const b = await chromium.launch(); const db = await seededDb(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); await install(ctx, db);
  let aiBody = null;
  await ctx.route('**/api/generate-questions', async (route) => { aiBody = route.request().postData(); await route.fulfill({ status: 503, body: '{"error":"off in test"}' }); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|generate-questions|503/.test(m.text())) errs.push(m.text()); });
  const W = (ms = 300) => p.waitForTimeout(ms);
  const body = () => p.locator('#root').innerText();
  const row = (id) => db.tables.v2_products.find((r) => r.id === id).data;
  try {
    await p.goto(URL); await W(800); await signIn(p, EMAIL.client);

    // 1. dashboard insights render and a chart filters the list
    await p.goto(URL + '#dashboard'); await W(800);
    assert((await body()).includes('Portfolio insights'), 'insights shown');
    assert(await p.locator('.insight-grid .recharts-surface').count() >= 5, 'charts drawn');
    await p.locator('.cb-row').first().click(); await W();
    assert((await body()).includes('below 50') || (await body()).includes('Products:'), 'compass filter applied');
    await p.getByRole('button', { name: /Clear filter/ }).click(); await W();

    // 2. mandatory checks block submit; optional ones need a real reason to skip
    await p.goto(URL + '#product--sys-1'); await W(600);
    assert((await body()).includes('mandatory check'), 'mandatory blocker shown');
    assert(await p.getByRole('button', { name: /Submit for review/ }).isDisabled(), 'submit blocked');
    const opt = p.locator('.check-item.open', { hasText: 'Third-party dependencies' });
    await opt.getByRole('button', { name: 'Skip', exact: true }).click();
    await p.selectOption('.ci-form select', 'planned');
    await p.fill('.ci-form textarea', 'later');
    assert(await p.getByRole('button', { name: 'Skip with this reason' }).isDisabled(), 'junk reason refused');
    await p.fill('.ci-form textarea', 'Vendor update policy is being agreed with procurement this month.');
    await p.getByRole('button', { name: 'Skip with this reason' }).click(); await W(300);
    assert((await body()).includes('Choose the date it will be done'), 'planned needs a date');
    const d = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    await p.fill('.ci-form input[type=date]', d);
    await p.getByRole('button', { name: 'Skip with this reason' }).click(); await W(700);
    const rec = row('sys-1').stages['4'];
    assert(rec.skipped['Third-party dependencies and update behavior are controlled.']?.due === d, 'skip saved to the database');
    assert(row('sys-1').actions.some((a) => a.source === 'checklist' && a.item.startsWith('Third-party')), 'skip raised an action');
    assert(await p.locator('.check-item.open', { hasText: 'Access follows least privilege' }).getByRole('button', { name: 'Skip', exact: true }).count() === 0, 'mandatory item has no skip');
    await p.getByRole('button', { name: 'Tick all' }).click(); await W(500);
    assert(!(await p.getByRole('button', { name: /Submit for review/ }).isDisabled()), 'submit allowed with every check ticked or skipped');
    assert(row('sys-1').stages['4'].skipped['Third-party dependencies and update behavior are controlled.'], 'tick all keeps skips');
    await p.getByRole('button', { name: /Submit for review/ }).click(); await W(700);
    assert(row('sys-1').stages['4'].status === 'submitted', 'submitted');

    // 3. AI card: edit, save as a new version
    await p.goto(URL + '#card--sys-2'); await W(600);
    assert((await body()).includes('Card completeness'), 'card page');
    await p.getByRole('button', { name: /Edit card/ }).click();
    await p.getByLabel('Known limitations').fill('Not validated for applicants over 75.');
    await p.getByRole('button', { name: 'Save card' }).click(); await W(700);
    assert(row('sys-2').card?.limitations === 'Not validated for applicants over 75.' && row('sys-2').card.version === 1, 'card saved with version');
    await p.goto(URL + '#cards'); await W(500);
    assert(await p.locator('.glossary-row').count() >= 3, 'registry lists the cards');

    // 4. the deck downloads
    await p.goto(URL + '#product--sys-1'); await W(600);
    await p.getByRole('button', { name: /^Report/ }).click();
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 40000 }), p.getByRole('menuitem', { name: /Dashboard deck/ }).click()]);
    assert(/dashboard\.pptx$/.test(dl.suggestedFilename()), 'deck file');
    const fs = require('fs'); const path = await dl.path(); assert(fs.statSync(path).size > 50000, 'deck has content');

    // 5. what leaves for the AI: no names, owner, organisation, contact details
    await p.goto(URL + '#new'); await W(500);
    await p.fill('input[placeholder="e.g. Claims triage model"]', 'Zebra pricing engine');
    await p.fill('input[placeholder="e.g. Claims"]', 'Quokka unit'); await p.fill('input[placeholder="Full name"]', 'Ottoline Brandsma');
    await p.fill('textarea', 'Prices cover for Northwind Insurance customers. Contact ottoline@northwind.test or +44 20 7946 0958, ref 99887766554.');
    await p.selectOption('#domain', 'insurance'); await p.selectOption('#type', 'ml'); await p.selectOption('#sourcing', 'build');
    const combo = p.getByLabel('Countries'); await combo.click(); await combo.fill('India'); await p.keyboard.press('Enter'); await p.keyboard.press('Escape'); await p.click('h1');
    await p.getByRole('checkbox', { name: 'Personal data', exact: true }).click();
    await p.getByRole('button', { name: 'Continue' }).click(); await W();
    await p.getByRole('button', { name: /Use suggested/ }).click(); await p.getByRole('button', { name: 'Continue' }).click(); await W();
    await answerRiskProfile(p, { idx: 0 });
    await p.locator('.risk-pillar .risk-options').first().locator('[role=radio]', { hasText: 'Not known' }).click();
    await p.getByRole('button', { name: 'Continue' }).click(); await W(1500);
    assert(aiBody, 'AI endpoint called');
    for (const leak of ['Zebra', 'Quokka', 'Ottoline', 'Brandsma', 'Northwind', 'ottoline@', '7946', '99887766554', 'Priya']) assert(!aiBody.includes(leak), `AI payload leaked ${leak}`);
    assert(JSON.parse(aiBody).useCase.description.includes('Prices cover'), 'description still useful');
    // answer with "Not known" and register
    for (let k = 0; k < 8; k++) {
      for (const lad of await p.locator('.ladder').all()) await lad.locator('[role=radio]').nth(2).click();
      const nx = p.getByRole('button', { name: 'Next section' }); if (await nx.count()) await nx.click(); else break;
    }
    await p.locator('.choice.unknown').first().click();
    await p.getByRole('button', { name: 'Continue' }).click(); await W();
    assert(/Not known\s*1 control/.test(await body()), 'review shows not known count');
    await p.getByRole('button', { name: 'Register product' }).click(); await W(900);
    const mine = db.tables.v2_products.find((r) => r.name === 'Zebra pricing engine').data;
    assert(mine.assessment.results.unknownControls.length === 1 && mine.assessment.results.unknownProfile.length === 1, 'unknowns scored');
    assert(mine.actions.filter((a) => a.source === 'unknown').length === 2, 'find-out actions created');

    // 6. reviewer: sees the skip reason, can require an action on a control, cannot skip
    await signOut(p); await signIn(p, EMAIL.assessor);
    await p.goto(URL + '#product--sys-1'); await W(600);
    assert((await body()).includes('1 check skipped') || (await body()).includes('checks skipped'), 'reviewer told about skips');
    assert((await body()).includes('Vendor update policy'), 'reviewer sees the reason');
    assert(await p.getByRole('button', { name: 'Skip', exact: true }).count() === 0, 'reviewer cannot skip');
    await p.getByRole('tab', { name: /Actions/ }).click(); await W();
    await p.locator('tr', { hasText: 'MOD-01' }).getByRole('button', { name: 'Raise action' }).click();
    await p.getByLabel('Action').fill('Show the signed vendor update policy before go-live.');
    await p.fill('.ci-form input[type=date]', d);
    await p.getByRole('button', { name: 'Add action' }).click(); await W(700);
    assert(row('sys-1').actions.some((a) => a.source === 'reviewer' && a.control === 'MOD-01'), 'reviewer action saved');

    // 7. administrator: checklist rules
    await signOut(p); await signIn(p, EMAIL.admin);
    await p.goto(URL + '#settings'); await W(500);
    await p.selectOption('select[aria-label="Rule for The problem and intended outcome are clearly defined."]', 'mandatory'); await W(600);
    const st = db.tables.v2_settings.find((x) => x.key === 'settings').value;
    assert(st.checklistRules['The problem and intended outcome are clearly defined.'] === 'mandatory', 'rule saved');
    console.log(JSON.stringify({ ok: true, errors: errs }));
  } catch (e) {
    await p.screenshot({ path: '/tmp/features-fail.png' }).catch(() => {});
    console.log(JSON.stringify({ ok: false, error: e.message.split('\n')[0], errors: errs }));
  }
  await b.close();
})();
