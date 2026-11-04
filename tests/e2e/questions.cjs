// Administrator adds questions; a client sees them in a new assessment. Cloud build on port 4174.
const { chromium } = require('playwright');
const { install, seededDb, signIn, signOut } = require('./fake-supabase.cjs');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

(async () => {
  const URL = 'http://localhost:4174/';
  const db = await seededDb(); const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await install(ctx, db);
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  const W = (ms = 300) => p.waitForTimeout(ms);
  const body = () => p.locator('#root').innerText();
  const btn = (n) => p.getByRole('button', { name: n, exact: true });

  await p.goto(URL); await W(700);
  // sign-in page: lifecycle list has one number per stage (no extra list markers)
  const marker = await p.evaluate(() => { const li = document.querySelector('.landing-stages li'); return li ? getComputedStyle(li, '::marker').content : 'none'; });
  const listStyle = await p.evaluate(() => getComputedStyle(document.querySelector('.landing-stages')).listStyleType);
  assert(listStyle === 'none' && (marker === 'none' || marker === 'normal' || marker === '""'), `no double numbering (${listStyle}, ${marker})`);

  await signIn(p, 'admin@gov.test'); await p.goto(URL + '#bank'); await W(500);
  await btn('Add a question').click(); await W();
  await btn('Add question').click(); assert((await body()).includes('Still needed: the question, all four options, a short topic'), 'validation');
  const form = p.locator('.qform');
  await form.getByLabel('Section', { exact: true }).selectOption('GDPR');
  await form.getByLabel('Responsible AI principle').selectOption('privacy');
  await form.getByLabel(/^Reference/).fill('Art. 28');
  await form.getByLabel('Topic').fill('Vendor processing agreements');
  await form.getByLabel(/^Question/).fill('Is a signed data processing agreement in place with every AI vendor that handles data about {subject}?');
  const opts = ['No agreements', 'Some vendors covered', 'All vendors covered', 'All covered and reviewed every year'];
  for (let i = 0; i < 4; i++) await form.getByLabel(new RegExp(`^Option ${i + 1}`)).fill(opts[i]);
  await form.getByLabel(/Offer "Not applicable"/).check(); await form.getByLabel('Not applicable wording').fill('We use no AI vendors');
  await form.getByLabel(/^Action when/).fill('Sign processing agreements with every AI vendor.');
  await btn('Add question').click(); await W(600);
  let saved = db.tables.v2_settings.find((s) => s.key === 'settings').value.customQuestions;
  assert(saved && saved.length === 1 && saved[0].section === 'GDPR' && saved[0].options[3] === opts[3], 'saved to settings');
  assert((await body()).includes('Your questions') && (await body()).includes('Added by admin'), 'listed in bank');
  // a second one, then turn it off
  await btn('Add a question').click(); const f2 = p.locator('.qform');
  await f2.getByLabel('Topic').fill('Ethics board'); await f2.getByLabel(/^Question/).fill('Has the ethics board reviewed this product?');
  for (let i = 0; i < 4; i++) await f2.getByLabel(new RegExp(`^Option ${i + 1}`)).fill(['No', 'Planned', 'Reviewed', 'Reviewed and minuted'][i]);
  await btn('Add question').click(); await W(500);
  await p.locator('.q-review', { hasText: 'ethics board' }).getByRole('button', { name: 'Turn off' }).click(); await W(500);
  saved = db.tables.v2_settings.find((s) => s.key === 'settings').value.customQuestions;
  assert(saved.length === 2 && saved.find((q) => q.topic === 'Ethics board').active === false, 'turned off');
  // edit the first
  await p.locator('.q-review', { hasText: 'data processing agreement' }).getByRole('button', { name: 'Edit' }).click(); await W();
  await p.locator('.qform').getByLabel('Topic').fill('Vendor DPAs'); await btn('Save changes').click(); await W(500);
  assert(db.tables.v2_settings.find((s) => s.key === 'settings').value.customQuestions.find((q) => q.section === 'GDPR').topic === 'Vendor DPAs', 'edited');
  assert(db.tables.v2_audit.some((r) => r.action === 'Question added') && db.tables.v2_audit.some((r) => r.action === 'Question edited'), 'audited');
  await signOut(p);

  // a reviewer cannot change questions, even directly in the database
  await signIn(p, 'reviewer@gov.test');
  await p.goto(URL + '#bank'); await W(); assert((await body()).includes('not available for your role'), 'reviewer blocked from bank');
  const st = await p.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('governai.auth'));
    return (await fetch('https://fake.supabase.co/rest/v1/v2_settings', { method: 'POST', headers: { apikey: 'test', Authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates' }, body: JSON.stringify([{ key: 'settings', value: {} }]) })).status;
  });
  assert(st === 403, 'reviewer cannot write settings');
  await signOut(p);

  // client: the GDPR question appears when GDPR is in scope; the turned-off one does not
  await signIn(p, 'priya@northwind.test'); await p.goto(URL + '#new'); await W(400);
  await p.fill('input[placeholder="e.g. Claims triage model"]', 'Vendor claims model');
  await p.fill('input[placeholder="e.g. Claims"]', 'Claims'); await p.fill('input[placeholder="Full name"]', 'Priya Nair');
  await p.fill('textarea', 'Scores claims using a vendor model and policyholder data.');
  await p.selectOption('#domain', 'insurance'); await p.selectOption('#type', 'ml'); await p.selectOption('#sourcing', 'vendor');
  const combo = p.getByLabel('Countries'); await combo.click(); await combo.fill('Germ'); await p.keyboard.press('Enter'); await p.keyboard.press('Escape'); await p.click('h1');
  await p.getByRole('checkbox', { name: 'Personal data', exact: true }).click();
  await btn('Continue').click(); await W();
  await p.getByRole('button', { name: /Use suggested/ }).click(); await btn('Continue').click(); await W();
  for (const s of await p.locator('main select').all()) { const id = await s.getAttribute('id'); if (['prohibitedAny', 'annex', 'narrow', 'profiling'].includes(id)) continue; await s.selectOption({ index: 1 }); }
  await p.selectOption('#prohibitedAny', 'no'); await p.selectOption('#annex', 'none');
  await btn('Continue').click(); await W(1200);
  let found = false; let off = false;
  for (let k = 0; k < 10; k++) {
    const t = await body();
    if (t.includes('data processing agreement in place with every AI vendor that handles data about policyholders')) found = true;
    if (t.includes('ethics board reviewed')) off = true;
    const nx = btn('Next section'); if (await nx.count()) { await nx.click(); await W(200); } else break;
  }
  assert(found, 'client sees the admin question with {subject} filled in');
  assert(!off, 'turned-off question not asked');

  assert(errs.length === 0, errs.join('\n'));
  console.log(JSON.stringify({ ok: true }));
  await b.close();
})().catch((e) => { console.log(JSON.stringify({ ok: false, error: e.message })); process.exit(1); });
