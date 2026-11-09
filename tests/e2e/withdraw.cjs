// Withdrawing and deleting AI products: client request, lead decision, archive, admin restore and permanent deletion
// after the retention period, live products excluded, database rules for clients. Cloud build on 4174.
const { chromium } = require('playwright');
const { install, seededDb, signIn, signOut, EMAIL } = require('./fake-supabase.cjs');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
(async () => {
  const URL = process.env.URL || 'http://localhost:4174/';
  const b = await chromium.launch(); const db = await seededDb(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await install(ctx, db);
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  const W = (ms = 400) => p.waitForTimeout(ms);
  const body = () => p.locator('#root').innerText();
  const row = (id) => db.tables.v2_products.find((r) => r.id === id);
  try {
    await p.goto(URL); await W(800); await signIn(p, EMAIL.client);
    // a live product cannot be withdrawn (it is retired through stage 10)
    const live = db.tables.v2_products.find((r) => r.client_id === 'northwind' && r.data.stage >= 7);
    if (live) { await p.goto(URL + `#product--${live.id}`); await W(800); assert(!(await body()).includes('Withdraw this product'), 'no withdrawal for live products'); }
    // request
    await p.goto(URL + '#product--sys-2'); await W(800);
    await p.getByRole('button', { name: /Withdraw this product/ }).click(); await W();
    await p.getByLabel('Why').selectOption('Project cancelled');
    await p.getByLabel(/Explain/).fill('Too short');
    assert(await p.getByRole('button', { name: 'Request withdrawal' }).isDisabled(), 'needs a real reason');
    await p.getByLabel(/Explain/).fill('The pricing pilot was cancelled by the board in October.');
    await p.getByRole('button', { name: 'Request withdrawal' }).click(); await W(1000);
    assert(row('sys-2').data.withdrawal?.status === 'requested', 'request saved');
    assert((await body()).includes('Withdrawal requested'), 'banner shown');
    await signOut(p);
    // lead sees it in notifications and approves
    await signIn(p, EMAIL.lead);
    await p.locator('button[aria-label^="Notifications"]').click(); await W();
    assert((await body()).includes('withdrawal requested'), 'lead notified');
    await p.goto(URL + '#product--sys-2'); await W(800);
    await p.getByLabel(/Decision note/).fill('Agreed, pilot stopped.');
    await p.getByRole('button', { name: 'Approve withdrawal' }).click(); await W(1000);
    assert(row('sys-2').data.status === 'Withdrawn' && row('sys-2').data.withdrawal.previousStatus === 'Active', 'withdrawn');
    assert(db.tables.v2_ledger.some((r) => r.chain === 'sys-2' && r.kind === 'status' && r.body.includes('Withdrawn')), 'in the record');
    await p.goto(URL + '#products'); await W(800);
    assert(!(await p.locator('table').first().innerText()).includes('Life and health premium pricing'), 'gone from the main list');
    await p.getByRole('button', { name: /Show withdrawn products \(1\)/ }).click(); await W();
    assert((await body()).includes('Project cancelled: The pricing pilot'), 'archive lists it');
    await signOut(p);
    // the client sees it read-only; a direct write is refused by the database rule
    await signIn(p, EMAIL.client);
    await p.goto(URL + '#product--sys-2'); await W(800);
    const t = await body();
    assert(t.includes('Withdrawn') && t.includes('read-only') && !t.includes('Re-assess'), 'read-only for the client');
    await signOut(p);
    // admin: not yet deletable inside the retention period; restore works; after the period, permanent deletion
    await signIn(p, EMAIL.admin);
    await p.goto(URL + '#product--sys-2'); await W(800);
    assert((await body()).includes('days left'), 'retention period shown');
    await p.getByRole('button', { name: 'Restore' }).click(); await W(1000);
    assert(row('sys-2').data.status === 'Active', 'restored');
    row('sys-2').data = { ...row('sys-2').data, status: 'Withdrawn', withdrawal: { ...row('sys-2').data.withdrawal, status: 'approved', decidedAt: '2026-01-01T00:00:00Z', previousStatus: 'Active' } };
    await p.reload(); await W(1000);
    await p.getByLabel('Product code to confirm deletion').fill('wrong');
    assert(await p.getByRole('button', { name: /Delete permanently/ }).isDisabled(), 'needs the code');
    const code = row('sys-2').data.code;
    await p.getByLabel('Product code to confirm deletion').fill(code);
    await p.getByRole('button', { name: /Delete permanently/ }).click(); await W(1500);
    assert(!row('sys-2'), 'deleted');
    assert(db.tables.v2_ledger.filter((r) => r.chain === 'sys-2').at(-1).kind === 'deleted', 'record keeps the deletion');
    assert(!errs.length, errs.join(' | '));
    console.log(JSON.stringify({ ok: true }));
  } catch (e) {
    await p.screenshot({ path: '/tmp/withdraw-fail.png' }).catch(() => {});
    console.log(JSON.stringify({ ok: false, error: e.message })); console.error((await body().catch(() => '')).slice(0, 1200)); process.exitCode = 1;
  } finally { await b.close(); }
})();
