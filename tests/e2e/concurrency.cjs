// Two people saving the same product: the second save is refused, the screen loads the other person's version with a
// clear message, nothing is overwritten, and the next change saves normally. Cloud build on 4174.
const { chromium } = require('playwright');
const { install, seededDb, signIn, EMAIL } = require('./fake-supabase.cjs');
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
    await p.goto(URL + '#card--sys-2'); await W(800);
    const rev0 = row('sys-2').rev || 0;
    // someone else (a colleague in another browser) saves the product now
    const other = JSON.parse(JSON.stringify(row('sys-2')));
    other.data.card = { ...(other.data.card || {}), limitations: 'Written by a colleague first.' };
    Object.assign(row('sys-2'), { data: other.data, rev: rev0 + 1 });
    // this screen still holds the older version and saves over it
    await p.getByRole('button', { name: /Edit card/ }).click(); await W();
    await p.getByLabel('Known limitations').fill('My stale edit.');
    await p.getByRole('button', { name: 'Save card' }).click(); await W(2000);
    assert(row('sys-2').data.card.limitations === 'Written by a colleague first.', 'the colleague\'s save is not overwritten');
    const t = await body();
    assert(/Someone else changed .* while you were working on it/.test(t), 'the person is told why: ' + t.slice(0, 600));
    assert(t.includes('Written by a colleague first.'), 'the latest version is on screen');
    // making the change again now works
    await p.getByRole('button', { name: /Edit card/ }).click(); await W();
    await p.getByLabel('Known limitations').fill('Agreed final wording.');
    await p.getByRole('button', { name: 'Save card' }).click(); await W(1200);
    assert(row('sys-2').data.card.limitations === 'Agreed final wording.' && row('sys-2').rev === rev0 + 2, 'the next save goes through');
    // other products were never blocked
    await p.goto(URL + '#card--sys-1'); await W(800);
    await p.getByRole('button', { name: /Edit card/ }).click(); await W();
    await p.getByLabel('Known limitations').fill('Independent product edit.');
    await p.getByRole('button', { name: 'Save card' }).click(); await W(1200);
    assert(row('sys-1').data.card.limitations === 'Independent product edit.', 'unrelated product saved');
    assert(!errs.length, 'page errors: ' + errs.join(' | '));
    console.log(JSON.stringify({ ok: true }));
  } catch (e) { console.log(JSON.stringify({ ok: false, error: e.message, errs })); process.exitCode = 1; }
  await b.close();
})();
