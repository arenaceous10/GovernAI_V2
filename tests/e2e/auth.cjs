// Sign-up, sign-in and role-based access, against the Supabase stand-in (cloud build on port 4174).
const { chromium } = require('playwright');
const { install, seededDb, signIn, signOut, PASSWORD } = require('./fake-supabase.cjs');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

(async () => {
  const URL = process.env.URL || 'http://localhost:4174/';
  const db = await seededDb(); const b = await chromium.launch(); const errs = [];
  const open = async (w = 1440) => {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 } }); await install(ctx, db);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|generate-questions/.test(m.text())) errs.push(m.text()); });
    return p;
  };
  const W = (p, ms = 300) => p.waitForTimeout(ms);
  const body = (p) => p.locator('#root').innerText();
  const btn = (p, n) => p.getByRole('button', { name: n, exact: true });
  const signUp = async (p, f) => {
    await p.getByRole('tab', { name: 'Create account' }).click();
    if (f.side) await p.getByRole('radio', { name: f.side === 'client' ? /^Client/ : /Governance team/ }).click();
    if (f.name) await p.getByLabel('Full name').fill(f.name);
    await p.getByLabel('Work email').fill(f.email);
    if (f.company) await p.getByLabel('Organisation').fill(f.company);
    if (f.role) await p.getByLabel('Role you need').selectOption(f.role);
    await p.getByLabel('Password', { exact: true }).fill(f.password || PASSWORD);
    await btn(p, 'Create account').click(); await W(p, 900);
  };

  // 1. signed out: only the sign-in screen, nothing else
  let p = await open(); await p.goto(URL); await W(p, 800);
  let t = await body(p);
  assert(t.includes('Welcome back') && !t.includes('Northwind') && !t.includes('Motor claims'), 'sign-in screen, no data');
  await p.goto(URL + '#product--sys-1'); await W(p, 600); assert(!(await body(p)).includes('Motor claims'), 'deep link does not leak data');

  // 2. validation and wrong password
  await btn(p, 'Sign in').click(); await W(p); assert((await body(p)).includes('Enter your email and password'), 'empty sign-in validated');
  await p.getByLabel('Work email').fill('priya@northwind.test'); await p.getByLabel('Password', { exact: true }).fill('wrong-pass'); await btn(p, 'Sign in').click(); await W(p, 600);
  assert((await body(p)).includes('Email or password is incorrect'), 'wrong password message');
  await p.getByRole('button', { name: 'Show password' }).click(); assert(await p.getByLabel('Password', { exact: true }).getAttribute('type') === 'text', 'show password');

  // 3. sign-up validation
  await p.getByRole('tab', { name: 'Create account' }).click(); await btn(p, 'Create account').click(); await W(p);
  assert((await body(p)).includes('Choose Client or Governance team'), 'side required');
  await signUp(p, { side: 'client', name: 'Short Pw', email: 'short@new.test', company: 'Short Co', password: 'abc' });
  assert((await body(p)).includes('at least 8 characters'), 'password length');

  // 4. client with a new organisation: waits for an administrator, then lands in an empty portfolio, own org only
  await p.getByLabel('Password', { exact: true }).fill(PASSWORD); await p.getByLabel('Full name').fill('Rita Sen'); await p.getByLabel('Work email').fill('rita@acme.test'); await p.getByLabel('Organisation').fill('Acme Health');
  await btn(p, 'Create account').click(); await p.locator('.auth-done').waitFor({ timeout: 20000 }); await W(p, 300);
  t = await body(p); assert(t.includes('Waiting for approval') && t.includes('checks every new account'), 'new organisation waits: ' + t.slice(0, 300));
  const pendingAcme = db.tables.v2_profiles.find((x) => x.email === 'rita@acme.test');
  assert(pendingAcme.status === 'pending' && pendingAcme.client_id, 'pending with its new organisation');
  pendingAcme.status = 'active';   // an administrator approves
  await btn(p, 'Check again').click(); await p.locator('.shell').waitFor({ timeout: 20000 }); await W(p, 600);
  await p.goto(URL + '#product--sys-1'); await W(p, 400);
  assert((await body(p)).includes('This product was not found'), 'deep link to another org product shows not found');
  await p.goto(URL + '#dashboard'); await W(p, 400);
  t = await body(p);
  assert(t.includes('Acme Health') && t.includes('Your AI lifecycle') && t.includes('Rita Sen'), 'new client lands in own portal: ' + t.slice(0, 600));
  assert(!/Northwind|Meridian|Motor claims|CV screening/.test(t), 'sees no other organisation');
  assert(await p.locator('select[aria-label="Switch role"]').count() === 0, 'no role switcher');
  const acme = db.tables.v2_profiles.find((x) => x.email === 'rita@acme.test'); assert(acme.status === 'active' && acme.role === 'client' && acme.client_id, 'active client profile');
  for (const h of ['#queue', '#admin', '#audit', '#settings', '#bank', '#catalog']) { await p.goto(URL + h); await W(p, 300); assert((await body(p)).includes('not available for your role'), 'client blocked from ' + h); }
  await p.goto(URL + '#product--sys-1'); await W(p, 400); assert(!(await body(p)).includes('Motor claims'), 'cannot open another organisation product');
  // even asking the database directly returns nothing from other organisations or internal notes
  const direct = await p.evaluate(async () => {
    const sess = JSON.parse(localStorage.getItem('governai.auth'));
    const h = { apikey: 'test', Authorization: `Bearer ${sess.access_token}` };
    const get = async (tb) => (await fetch(`https://fake.supabase.co/rest/v1/${tb}?select=*`, { headers: h })).json();
    const patch = await fetch('https://fake.supabase.co/rest/v1/v2_profiles?id=eq.' + sess.user.id, { method: 'PATCH', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'admin' }) });
    return { products: (await get('v2_products')).length, notes: (await get('v2_notes')).length, profiles: (await get('v2_profiles')).length, clients: (await get('v2_clients')).length, patch: patch.status };
  });
  assert(direct.products === 0 && direct.notes === 0 && direct.profiles === 1 && direct.clients === 1, 'database filters rows ' + JSON.stringify(direct));
  assert(direct.patch === 403 && db.tables.v2_profiles.find((x) => x.email === 'rita@acme.test').role === 'client', 'cannot make itself admin');
  await signOut(p); assert((await body(p)).includes('Welcome back'), 'signed out');

  // 5. joining an existing organisation waits for approval
  await signUp(p, { side: 'client', name: 'Copy Cat', email: 'cat@northwind.test', company: 'northwind insurance' });
  t = await body(p); assert(t.includes('Waiting for approval') && t.includes('checks every new account') && !t.includes('Motor claims'), 'existing org pending');
  await btn(p, 'Sign out').click(); await W(p, 500);

  // 6. governance team sign-up waits for an administrator
  await signUp(p, { side: 'team', name: 'Kabir Das', email: 'kabir@gov.test', role: 'lead' });
  t = await body(p); assert(t.includes('Waiting for approval') && t.includes('confirmed by an administrator'), 'team pending');
  const kabir = db.tables.v2_profiles.find((x) => x.email === 'kabir@gov.test'); assert(!kabir.role && kabir.requested_role === 'lead' && kabir.status === 'pending', 'no role until approved');
  await btn(p, 'Sign out').click(); await W(p, 500);
  // existing email
  await signUp(p, { side: 'client', name: 'Dup', email: 'priya@northwind.test', company: 'X' });
  assert((await body(p)).includes('already exists'), 'duplicate email message');

  // 7. admin approves: Kabir as reviewer, Copy Cat into Northwind
  await signIn(p, 'admin@gov.test'); await p.goto(URL + '#admin'); await W(p, 500);
  t = await body(p); assert(t.includes('Waiting for approval') && t.includes('Kabir Das') && t.includes('Copy Cat'), 'admin sees pending people');
  await p.getByLabel('Role for Kabir Das').selectOption('assessor');
  await p.locator('tr', { hasText: 'Kabir Das' }).getByRole('button', { name: 'Approve' }).click(); await W(p, 600);
  assert(db.tables.v2_profiles.find((x) => x.email === 'kabir@gov.test').role === 'assessor' && db.tables.v2_profiles.find((x) => x.email === 'kabir@gov.test').status === 'active', 'Kabir approved as reviewer');
  const catRow = p.locator('tr', { hasText: 'Copy Cat' });
  assert(await catRow.getByLabel('Organisation for Copy Cat').inputValue() === 'northwind', 'pending client pre-filled with the org they asked for');
  await catRow.getByRole('button', { name: 'Approve' }).click(); await W(p, 600);
  assert(db.tables.v2_profiles.find((x) => x.email === 'cat@northwind.test').status === 'active', 'client approved');
  assert(await p.getByLabel('Role for Neha Gupta').isDisabled(), 'admin cannot change own role');
  assert(db.tables.v2_audit.some((r) => r.action === 'Access changed' && r.actor_name === 'Neha Gupta'), 'access change audited with name');
  await signOut(p);

  // 8. approved people see their own workspace only
  await signIn(p, 'kabir@gov.test'); t = await body(p);
  assert(t.includes('Review workspace') && t.includes('Kabir Das') && t.includes('Governance reviewer'), 'reviewer workspace');
  await p.goto(URL + '#admin'); await W(p); assert((await body(p)).includes('not available for your role'), 'reviewer blocked from admin');
  await p.goto(URL + '#new'); await W(p); assert((await body(p)).includes('not available for your role'), 'reviewer cannot register');
  await signOut(p);
  await signIn(p, 'cat@northwind.test'); t = await body(p);
  assert(t.includes('Northwind Insurance') && t.includes('Motor claims triage model') && !t.includes('CV screening'), 'approved client sees own org');
  // session survives reload, still no switcher
  await p.reload(); await p.locator('.shell').waitFor({ timeout: 20000 }); await W(p, 500);
  assert((await body(p)).includes('Copy Cat') && await p.locator('select[aria-label="Switch role"]').count() === 0, 'session kept on reload');
  await signOut(p);

  // 9. admin turns access off
  await signIn(p, 'admin@gov.test'); await p.goto(URL + '#admin'); await W(p, 500);
  await p.locator('tr', { hasText: 'Copy Cat' }).getByRole('button', { name: 'Turn off' }).click(); await W(p, 600);
  await signOut(p); await p.getByLabel('Work email').fill('cat@northwind.test'); await p.getByLabel('Password', { exact: true }).fill(PASSWORD); await btn(p, 'Sign in').click(); await W(p, 900);
  assert((await body(p)).includes('Access turned off') && !(await body(p)).includes('Motor claims'), 'turned-off user blocked');
  await btn(p, 'Sign out').click(); await W(p, 500);

  // 10. forgot password
  await btn(p, 'Forgot password?').click(); await p.getByLabel('Work email').fill('priya@northwind.test'); await btn(p, 'Send reset link').click(); await W(p, 600);
  assert((await body(p)).includes('Check your email') && db.recovered === 'priya@northwind.test', 'reset email requested');

  // 11. email confirmation required (when the project asks for it)
  db.autoConfirm = false; await btn(p, 'Back to sign in').click();
  await signUp(p, { side: 'client', name: 'Mo', email: 'mo@confirm.test', company: 'Confirm Co' });
  assert((await body(p)).includes('confirmation link'), 'confirm-email message'); db.autoConfirm = true;

  // 12. mobile sign-in screen fits
  const m = await open(390); await m.goto(URL); await W(m, 700);
  assert(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile sign-in fits');
  await m.screenshot({ path: './e2e-shots/30-mobile-signin.png', fullPage: true });

  assert(errs.length === 0, errs.join('\n'));
  console.log(JSON.stringify({ ok: true, denied: db.denied.length, errors: errs }));
  await b.close();
})().catch((e) => { console.log(JSON.stringify({ ok: false, error: e.message })); process.exit(1); });
