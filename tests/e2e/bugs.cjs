// Regression tests for fixed bugs and the new tools (cloud build on port 4174).
const { chromium } = require('playwright');
const { install, seededDb, signIn, signOut, createAccount, PASSWORD } = require('./fake-supabase.cjs');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

(async () => {
  const URL = 'http://localhost:4174/';
  const db = await seededDb(); const b = await chromium.launch(); const errs = [];
  const open = async () => { const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await install(ctx, db); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); return p; };
  const p = await open();
  const W = (ms = 400) => p.waitForTimeout(ms);
  const body = () => p.locator('#root').innerText();
  const row = (id) => db.tables.v2_products.find((r) => r.id === id);
  await p.goto(URL); await W(800);

  // 1. double-clicking Approve moves exactly one stage (Store demand forecasting: stage 1, reviewer only)
  await signIn(p, 'reviewer@gov.test');
  const target = db.tables.v2_products.find((r) => r.name === 'Store demand forecasting');
  assert(target.stage === 1 && target.data.stages['1'].status === 'submitted', 'seed: stage 1 submitted');
  await p.goto(URL + '#product--' + target.id); await W(700);
  await p.getByRole('button', { name: 'Approve', exact: true }).dblclick(); await W(900);
  assert(row(target.id).stage === 2, 'double click moved one stage, got ' + row(target.id).stage);
  assert(db.tables.v2_audit.filter((r) => r.target === target.id && r.action === 'Stage approved' && /^Stage 1/.test(r.detail || '')).length <= 2, 'no extra approvals logged');
  assert((await body()).includes('Stage 1 approved'), 'toast shown');

  // 2. quick search (Ctrl K) finds a product and opens it
  await p.keyboard.press('Control+k'); await W(200);
  await p.keyboard.type('cv screen'); await W(200); await p.keyboard.press('Enter'); await W(700);
  assert((await p.locator('.product-hero').innerText()).includes('CV screening assistant'), 'search opened the product');
  await p.keyboard.press('Control+k'); await W(200); await p.keyboard.type('zzzz'); await W(200);
  assert((await body()).includes('No matches'), 'search empty state'); await p.keyboard.press('Escape'); await W(200);
  assert(await p.locator('.palette').count() === 0, 'escape closes search');

  // 3. notifications: reviewer sees submissions; mark all read clears the count
  await p.goto(URL + '#dashboard'); await W(500);
  const bell = p.getByRole('button', { name: /Notifications/ });
  assert(/new/.test(await bell.getAttribute('aria-label')), 'unread count shown');
  await bell.click(); await W(300); assert((await body()).includes('submitted'), 'submission listed');
  await p.getByRole('button', { name: 'Mark all read' }).click(); await W(200);
  assert(!/new/.test(await bell.getAttribute('aria-label')), 'marked read');
  await p.keyboard.press('Escape');

  // 4. deadline radar on the home screen and a deadline chip on a product
  t = await body(); assert(t.includes('Regulatory deadlines') && /EU AI Act|DPDP/.test(t), 'radar shown');
  await signOut(p);

  // 5. access turned off while signed in: the next refused save shows the turned-off screen
  await signIn(p, 'priya@northwind.test'); await p.goto(URL + '#product--sys-1'); await W(600);
  db.tables.v2_profiles.find((x) => x.email === 'priya@northwind.test').status = 'disabled';
  await p.locator('main input[type=checkbox]').last().click(); await W(2500);
  assert((await body()).includes('Access turned off'), 'turned-off screen after refused save');
  db.tables.v2_profiles.find((x) => x.email === 'priya@northwind.test').status = 'active';
  await p.getByRole('button', { name: /Sign out/ }).click(); await W(500);

  // 6. waiting for approval, then "Check again" lets them in without signing out
  createAccount(db, { email: 'new@gov.test', password: PASSWORD, meta: { name: 'New Reviewer', side: 'team', requested_role: 'assessor' } });
  await p.getByLabel('Work email').fill('new@gov.test'); await p.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await p.getByRole('button', { name: 'Sign in', exact: true }).click(); await W(900);
  assert((await body()).includes('Waiting for approval'), 'pending');
  Object.assign(db.tables.v2_profiles.find((x) => x.email === 'new@gov.test'), { role: 'assessor', status: 'active' });
  await p.getByRole('button', { name: /Check again/ }).click(); await p.locator('.shell').waitFor({ timeout: 15000 }); await p.goto(URL + '#dashboard'); await W(500);
  assert(!(await body()).includes('Not saved'), 'no warning left over from the previous person');
  await W(800); assert((await body()).includes('Review workspace') && (await body()).includes('New Reviewer'), 'check again signs them in: ' + (await body()).slice(0, 300));
  await signOut(p);

  // 7. product codes are unique even though each client only sees its own products
  const codes = db.tables.v2_products.map((r) => r.code); assert(new Set(codes).size === codes.length, 'seed codes unique');
  await signIn(p, 'isha@lotus.test'); await p.goto(URL + '#new'); await W(400);
  await p.fill('input[placeholder="e.g. Claims triage model"]', 'Lotus draft'); await p.getByRole('button', { name: 'Save draft', exact: true }).click(); await W(700);
  const code = db.tables.v2_products.find((r) => r.name === 'Lotus draft').code;
  assert(/^AI-\d{4}-[A-Z0-9]{5}$/.test(code) && !codes.includes(code), 'new code is unique: ' + code);

  assert(errs.length === 0, errs.join('\n'));
  console.log(JSON.stringify({ ok: true }));
  await b.close();
})().catch((e) => { console.log(JSON.stringify({ ok: false, error: e.message })); process.exit(1); });
