// Cloud mode end to end against an in-memory Supabase stand-in. Needs a build made with
//   VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=test npx vite build --outDir dist-cloudtest
// served on port 4174.
const { chromium } = require('playwright');
const { install, newDb, seededDb, addPeople, signIn, signOut } = require('./fake-supabase.cjs');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
(async () => {
  const URL = process.env.URL || 'http://localhost:4174/';
  const b = await chromium.launch(); const db = newDb(); addPeople(db); const errs = [];
  const open = async () => {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await install(ctx, db);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|injected|generate-questions/.test(m.text())) errs.push(m.text()); });
    return p;
  };
  const W = (p, ms = 250) => p.waitForTimeout(ms);
  const body = (p) => p.locator('#root').innerText();
  const btn = (p, n) => p.getByRole('button', { name: n, exact: true });
  const enter = async (p, who) => signIn(p, { client: 'priya@northwind.test', 'Governance reviewer': 'reviewer@gov.test', admin: 'admin@gov.test' }[who]);
  const productsRow = (id) => db.tables.v2_products.find((r) => r.id === id);

  // 1. an empty database is seeded when an administrator first signs in (not by clients)
  const p = await open(); await p.goto(URL); await W(p, 800);
  assert((await body(p)).includes('Welcome back'), 'sign-in shown');
  await enter(p, 'client'); t = await body(p);
  assert(db.tables.v2_products.length === 0 && t.includes('Your AI lifecycle'), 'a client never seeds');
  await signOut(p); await enter(p, 'admin');
  assert(db.tables.v2_products.length === 8 && db.tables.v2_clients.length === 3 && db.tables.v2_notes.length >= 1, 'admin seeded 8 products, 3 clients, notes');
  assert(db.tables.v2_settings.length === 2 && db.tables.v2_audit.length > 5, 'settings and audit seeded');
  assert(!JSON.stringify(db.tables.v2_products).includes(db.tables.v2_notes[0].text), 'internal notes not stored in products');
  await signOut(p);

  // 2. a change is saved; the row in the database changes, others do not
  await enter(p, 'client'); assert((await body(p)).includes('Saved'), 'sync status shown');
  await p.goto(URL + '#product--sys-1'); await W(p); await p.getByRole('tab', { name: 'Lifecycle' }).click(); await W(p);
  const before = JSON.stringify(productsRow('sys-3'));
  const auditBefore = db.tables.v2_audit.length;
  await p.getByRole('checkbox', { name: /Access follows least privilege/ }).check(); await W(p, 500);
  assert(productsRow('sys-1').data.stages['4'].checklist['Access follows least privilege and separation of duties.'] === true, 'checklist saved');
  assert(JSON.stringify(productsRow('sys-3')) === before, 'other products untouched');

  // 3. reload keeps data and the signed-in role
  await p.reload(); await W(p, 800); await p.locator('.shell').waitFor({ timeout: 20000 }); t = await body(p); assert(t.includes('Northwind Insurance') && t.includes('Priya Nair'), 'session kept after reload');
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
  await p2.goto(URL + '#product--sys-1'); await W(p2); assert(await p2.locator('main input[type=checkbox]').count() === 0, 'reviewer cannot tick');
  await p2.goto(URL + '#product--sys-1'); await W(p2); await p2.getByRole('tab', { name: 'Lifecycle' }).click(); await W(p2);
  assert(await p2.locator('.check-item.done', { hasText: 'Access follows least privilege' }).count() === 1, 'second browser sees the change');
  assert(db.tables.v2_products.length === 8, 'no duplicate seeding by the second load');

  // 6. save failure: warning, then retry saves it
  await p.goto(URL + '#product--sys-1'); await W(p); await p.getByRole('tab', { name: 'Lifecycle' }).click(); await W(p);
  db.fail = { method: '*', status: 500, message: 'injected failure' };
  await p.getByRole('checkbox', { name: /Deployment architecture supports/ }).check(); await W(p, 600);
  assert((await body(p)).includes('Not saved'), 'failure shown');
  assert(!productsRow('sys-1').data.stages['4'].checklist['Deployment architecture supports monitoring, rollback and kill switch.'], 'not saved while failing');
  db.fail = null; await btn(p, 'Retry').click(); await W(p, 600);
  assert(!(await body(p)).includes('Not saved'), 'retry cleared the warning');
  assert(productsRow('sys-1').data.stages['4'].checklist['Deployment architecture supports monitoring, rollback and kill switch.'] === true, 'retry saved the change');

  // 7. admin changes settings and resets the demo data (settings and signed-up organisations are kept)
  await signOut(p); await enter(p, 'admin');
  await p.click('nav >> text=Settings'); await W(p);
  await p.getByLabel('GDPR high').fill('58'); await btn(p, 'Save cut-offs').click(); await W(p, 500);
  assert(db.tables.v2_settings.find((s) => s.key === 'settings').value.cutoffs.GDPR.high === 58, 'cut-off saved');
  db.tables.v2_clients.push({ id: 'cli-real', name: 'Real Co' }); db.tables.v2_products.push({ id: 'sys-real', client_id: 'cli-real', name: 'Real product', status: 'Active', stage: 1, data: { ...productsRow('sys-2').data, id: 'sys-real', clientId: 'cli-real', name: 'Real product' } });
  await btn(p, 'Reset to demo data').click(); await btn(p, 'Yes, reset').click(); await W(p, 800);
  assert(productsRow('sys-1').data.stages['4'].checklist['Access follows least privilege and separation of duties.'] !== true, 'reset restored sample data');
  assert(productsRow('sys-real') && db.tables.v2_clients.some((c) => c.id === 'cli-real'), 'real organisation kept');
  assert(db.tables.v2_products.length === 9, 'demo products rewritten, nothing duplicated');

  // 8. an unreachable database after sign-in offers retry or sign out (no demo fallback with role switching)
  const down = await seededDb(); const ctx3 = await b.newContext(); await install(ctx3, down); const p3 = await ctx3.newPage(); p3.on('pageerror', (e) => errs.push(e.message));
  await p3.goto(URL); await W(p3, 600);
  await p3.getByLabel('Work email').fill('priya@northwind.test'); await p3.getByLabel('Password', { exact: true }).fill('Passw0rd!');
  down.fail = { method: 'GET', status: 503, message: 'database paused', table: 'v2_products' };
  await p3.getByRole('button', { name: 'Sign in', exact: true }).click();
  await p3.getByText("Couldn't reach the database").waitFor({ timeout: 25000 }); t = await body(p3);
  assert(t.includes('database paused') && !t.includes('Use demo data'), 'boot error shows the reason, no demo fallback');
  down.fail = null; await btn(p3, 'Try again').click(); await p3.locator('.shell').waitFor({ timeout: 20000 }); assert((await body(p3)).includes('Your AI lifecycle'), 'try again recovers');
  console.log(JSON.stringify({ ok: true, errors: errs }));
  await b.close();
})().catch((e) => { console.log(JSON.stringify({ ok: false, error: e.message, at: (e.stack || "").split("\n").find((l) => /cloud.cjs/.test(l)) })); process.exit(1); });
