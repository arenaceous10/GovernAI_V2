// Administrator edits and deletes client organisations (cloud build on port 4174).
const { chromium } = require('playwright');
const { install, seededDb, signIn, signOut, PASSWORD } = require('./fake-supabase.cjs');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

(async () => {
  const URL = 'http://localhost:4174/';
  const db = await seededDb(); const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await install(ctx, db);
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  const W = (ms = 400) => p.waitForTimeout(ms);
  const body = () => p.locator('#root').innerText();
  const btn = (n) => p.getByRole('button', { name: n, exact: true });
  await p.goto(URL); await W(800);
  await signIn(p, 'admin@gov.test'); await p.goto(URL + '#admin'); await W(500);

  // edit: duplicate name refused, then a rename saved
  await p.getByRole('button', { name: 'Edit Lotus Retail' }).click();
  await p.getByLabel('Edit organisation name').fill('northwind insurance'); await btn('Save').click(); await W();
  assert((await body()).includes('Another organisation already has this name'), 'duplicate refused');
  await p.getByLabel('Edit organisation name').fill(''); await btn('Save').click(); await W();
  assert((await body()).includes('Enter an organisation name'), 'empty refused');
  await p.getByLabel('Edit organisation name').fill('Lotus Retail Group'); await p.getByLabel('Edit sector').fill('Retail and e-commerce'); await btn('Save').click(); await W(700);
  const lotus = db.tables.v2_clients.find((c) => c.id === 'lotus');
  assert(lotus.name === 'Lotus Retail Group' && lotus.sector === 'Retail and e-commerce', 'rename saved to database');
  assert(db.tables.v2_audit.some((r) => r.action === 'Client edited' && /renamed to Lotus Retail Group/.test(r.detail)), 'edit audited');
  // cancel keeps the old values
  await p.getByRole('button', { name: 'Edit Lotus Retail Group' }).click(); await p.getByLabel('Edit organisation name').fill('Something else'); await btn('Cancel').click(); await W();
  assert((await body()).includes('Lotus Retail Group') && !(await body()).includes('Something else'), 'cancel keeps the name');

  // delete Meridian: shows what goes, needs the name typed
  const meridianProducts = db.tables.v2_products.filter((r) => r.client_id === 'meridian').map((r) => r.id);
  assert(meridianProducts.length === 3, 'seed: Meridian has 3 products');
  await p.getByRole('button', { name: 'Delete Meridian Bank' }).click(); await W();
  let t = await body(); assert(t.includes('3 products and their evidence and notes will be deleted') && t.includes('1 person goes back to waiting for approval'), 'consequences shown');
  assert(await btn('Delete organisation').isDisabled(), 'needs the name typed');
  await p.getByLabel('Type the organisation name to confirm').fill('Meridian'); assert(await btn('Delete organisation').isDisabled(), 'partial name not enough');
  await btn('Keep it').click(); await W(); assert(db.tables.v2_clients.some((c) => c.id === 'meridian'), 'keep it does nothing');
  await p.getByRole('button', { name: 'Delete Meridian Bank' }).click(); await p.getByLabel('Type the organisation name to confirm').fill('Meridian Bank');
  await btn('Delete organisation').click(); await W(1500);
  assert(!db.tables.v2_clients.some((c) => c.id === 'meridian'), 'organisation deleted');
  assert(!db.tables.v2_products.some((r) => meridianProducts.includes(r.id)), 'its products deleted');
  assert(!db.tables.v2_notes.some((n) => meridianProducts.includes(n.product_id)), 'its internal notes deleted');
  const arjun = db.tables.v2_profiles.find((x) => x.email === 'arjun@meridian.test');
  assert(arjun.status === 'pending' && !arjun.client_id, 'person moved to waiting for approval');
  assert(db.tables.v2_products.length === 5 && db.tables.v2_clients.length === 2, 'others untouched');
  assert(db.tables.v2_audit.some((r) => r.action === 'Client deleted' && /Meridian Bank: 3 products removed/.test(r.detail)), 'delete audited');
  const orgs = await p.locator('.panel', { hasText: 'Client organisations' }).innerText(); const waiting = await p.locator('.panel', { hasText: 'Waiting for approval' }).first().innerText();
  assert(!orgs.includes('Meridian Bank') && waiting.includes('Arjun Mehta'), 'gone from the list, person now waiting');
  // empty organisation deletes without typing
  await p.locator('.panel', { hasText: 'Add a client' }).getByLabel('Organisation name').fill('Empty Co'); await btn('Add client').click(); await W(600);
  await p.getByRole('button', { name: 'Delete Empty Co' }).click(); await W();
  assert(await p.getByLabel('Type the organisation name to confirm').count() === 0 && (await body()).includes('It has no products'), 'no typing for an empty org');
  await btn('Delete organisation').click(); await W(800);
  assert(!db.tables.v2_clients.some((c) => c.name === 'Empty Co'), 'empty org deleted');
  await signOut(p);

  // the moved person is waiting; the renamed client sees its new name
  await p.getByLabel('Work email').fill('arjun@meridian.test'); await p.getByLabel('Password', { exact: true }).fill(PASSWORD); await btn('Sign in').click(); await W(900);
  assert((await body()).includes('Waiting for approval') && !(await body()).includes('CV screening'), 'deleted org person cannot see its old products');
  await p.getByRole('button', { name: /Sign out/ }).click(); await W(500);
  await signIn(p, 'isha@lotus.test'); assert((await body()).includes('Lotus Retail Group'), 'client sees the new name');
  // a client cannot edit or delete organisations, even directly
  const st = await p.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('governai.auth')); const h = { apikey: 'test', Authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json' };
    const up = await fetch('https://fake.supabase.co/rest/v1/v2_clients', { method: 'POST', headers: { ...h, prefer: 'resolution=merge-duplicates' }, body: JSON.stringify([{ id: 'lotus', name: 'Hacked' }]) });
    await fetch('https://fake.supabase.co/rest/v1/v2_clients?id=eq.lotus', { method: 'DELETE', headers: h });
    return up.status;
  });
  assert(st === 403 && db.tables.v2_clients.find((c) => c.id === 'lotus')?.name === 'Lotus Retail Group', 'client blocked from editing or deleting organisations');
  await p.goto(URL + '#admin'); await W(); assert((await body()).includes('not available for your role'), 'client blocked from admin page');

  assert(errs.length === 0, errs.join('\n'));
  console.log(JSON.stringify({ ok: true }));
  await b.close();
})().catch((e) => { console.log(JSON.stringify({ ok: false, error: e.message })); process.exit(1); });
