// Cloud mode end to end against an in-memory Supabase stand-in. Needs a build made with
//   VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=test npx vite build --outDir dist-cloudtest
// served on port 4174.
const { chromium } = require('playwright');
const { install, newDb } = require('./fake-supabase.cjs');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
(async () => {
  const URL = process.env.URL || 'http://localhost:4174/';
  const b = await chromium.launch(); const db = newDb(); const errs = [];
  const open = async () => {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await install(ctx, db);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|injected|generate-questions/.test(m.text())) errs.push(m.text()); });
    return p;
  };
  const W = (p, ms = 250) => p.waitForTimeout(ms);
  const body = (p) => p.locator('#root').innerText();
  const btn = (p, n) => p.getByRole('button', { name: n, exact: true });
  const enter = async (p, who) => { await p.getByRole('radio', { name: who === 'client' ? /Client portal/ : /Governance team/ }).click(); if (who !== 'client') await p.getByRole('radio', { name: who }).click(); await btn(p, 'Enter GovernAI').click(); await W(p); };
  const productsRow = (id) => db.tables.v2_products.find((r) => r.id === id);

  // 1. first load seeds an empty database
  const p = await open(); await p.goto(URL); await W(p, 800);
  assert((await body(p)).includes('Responsible AI governance'), 'landing shown after load');
  assert(db.tables.v2_products.length === 8 && db.tables.v2_clients.length === 3 && db.tables.v2_users.length === 6, 'seeded 8/3/6');
  assert(db.tables.v2_settings.length === 2 && db.tables.v2_audit.length > 5, 'settings and audit seeded');
  const seededCalls = db.calls.length;

  // 2. a change is saved; the row in the database changes, others do not
  await enter(p, 'client'); assert((await body(p)).includes('Saved to database'), 'sync status shown');
  await p.goto(URL + '#product--sys-1'); await W(p); await p.getByRole('tab', { name: 'Lifecycle' }).click(); await W(p);
  const before = JSON.stringify(productsRow('sys-3'));
  const auditBefore = db.tables.v2_audit.length;
  await p.getByRole('checkbox', { name: /Access follows least privilege/ }).check(); await W(p, 500);
  assert(productsRow('sys-1').data.stages['4'].checklist['Access follows least privilege and separation of duties.'] === true, 'checklist saved');
  assert(JSON.stringify(productsRow('sys-3')) === before, 'other products untouched');

  // 3. reload keeps data and the signed-in role
  await p.reload(); await W(p, 800); t = await body(p); assert(t.includes('Northwind Insurance') && t.includes('Saved to database'), 'session kept after reload');
  await p.getByRole('tab', { name: 'Lifecycle' }).count();
  await p.goto(URL + '#product--sys-1'); await W(p); await p.getByRole('tab', { name: 'Lifecycle' }).click(); await W(p);
  assert(await p.getByRole('checkbox', { name: /Access follows least privilege/ }).isChecked(), 'change visible after reload');

  // 4. register flow writes a new product and audit rows; a draft can be saved and deleted
  await p.goto(URL + '#new'); await W(p);
  await p.fill('input[placeholder="e.g. Claims triage model"]', 'Cloud draft'); await btn(p, 'Save draft').click(); await W(p, 500);
  const draft = db.tables.v2_products.find((r) => r.name === 'Cloud draft'); assert(draft && draft.status === 'Draft' && draft.client_id === 'northwind', 'draft row saved');
  await p.goto(URL + '#products'); await W(p); await p.getByRole('button', { name: 'Delete draft Cloud draft' }).click(); await W(p, 500);
  assert(!db.tables.v2_products.some((r) => r.name === 'Cloud draft'), 'draft row deleted');
  assert(db.tables.v2_audit.length > auditBefore, 'audit rows added');

  // 5. a second browser sees the same data
  const p2 = await open(); await p2.goto(URL); await W(p2, 800); await enter(p2, 'Governance reviewer');
  await p2.goto(URL + '#product--sys-1'); await W(p2); await p2.getByRole('tab', { name: 'Lifecycle' }).click(); await W(p2);
  assert(await p2.getByRole('checkbox', { name: /Access follows least privilege/ }).isChecked(), 'second browser sees the change');
  assert(db.tables.v2_products.length === 8, 'no duplicate seeding by the second load');

  // 6. save failure: warning, then retry saves it
  await p.goto(URL + '#product--sys-1'); await W(p); await p.getByRole('tab', { name: 'Lifecycle' }).click(); await W(p);
  db.fail = { method: '*', status: 500, message: 'injected failure' };
  await p.getByRole('checkbox', { name: /Accessibility and inclusive design/ }).check(); await W(p, 600);
  assert((await body(p)).includes('Not saved'), 'failure shown');
  assert(!productsRow('sys-1').data.stages['4'].checklist['Accessibility and inclusive design requirements are implemented.'], 'not saved while failing');
  db.fail = null; await btn(p, 'Retry').click(); await W(p, 600);
  assert((await body(p)).includes('Saved to database'), 'retry cleared the warning');
  assert(productsRow('sys-1').data.stages['4'].checklist['Accessibility and inclusive design requirements are implemented.'] === true, 'retry saved the change');

  // 7. admin changes settings and resets the demo
  await p.getByRole('combobox', { name: 'Switch role' }).selectOption('admin'); await W(p);
  await p.click('nav >> text=Settings'); await W(p);
  await p.getByLabel('GDPR high').fill('58'); await btn(p, 'Save cut-offs').click(); await W(p, 500);
  assert(db.tables.v2_settings.find((s) => s.key === 'settings').value.cutoffs.GDPR.high === 58, 'cut-off saved');
  await btn(p, 'Reset to demo data').click(); await btn(p, 'Yes, reset').click(); await W(p, 800);
  assert(productsRow('sys-1').data.stages['4'].checklist['Access follows least privilege and separation of duties.'] !== true, 'reset restored sample data');
  assert(db.tables.v2_settings.find((s) => s.key === 'settings').value.cutoffs.GDPR === undefined, 'reset restored settings');
  assert(db.tables.v2_products.length === 8, 'still 8 products after reset');

  // 8. an unreachable database offers a way forward
  const down = newDb(); down.fail = { method: 'GET', status: 503, message: 'database paused' };
  const ctx3 = await b.newContext(); await install(ctx3, down); const p3 = await ctx3.newPage(); p3.on('pageerror', (e) => errs.push(e.message));
  await p3.goto(URL); await p3.getByText("Couldn't reach the database").waitFor({ timeout: 20000 }); t = await body(p3);
  assert(t.includes('database paused'), 'boot error shows the reason');
  down.fail = null; await btn(p3, 'Try again').click(); await W(p3, 800); assert((await body(p3)).includes('Responsible AI governance'), 'try again recovers');
  const ctx4 = await b.newContext(); await install(ctx4, down); const p4 = await ctx4.newPage(); down.fail = { method: 'GET', status: 503 };
  await p4.goto(URL); await btn(p4, 'Use demo data in this browser').waitFor({ timeout: 20000 }); await btn(p4, 'Use demo data in this browser').click(); await W(p4, 400);
  await enter(p4, 'client'); assert((await body(p4)).includes('Demo data in this browser'), 'offline fallback works');
  console.log(JSON.stringify({ ok: true, errors: errs }));
  await b.close();
})().catch((e) => { console.log(JSON.stringify({ ok: false, error: e.message })); process.exit(1); });
