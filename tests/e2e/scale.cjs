// How the app behaves with a large portfolio: N products (default 1000) and 20,000 audit entries in the fake database.
// Measures sign-in to first screen, each main page, opening a product and ticking a check (time until saved).
// Usage: N=1000 node tests/e2e/scale.cjs   (cloud build on 4174)
const { chromium } = require('playwright');
const { install, seededDb, signIn, EMAIL } = require('./fake-supabase.cjs');
(async () => {
  const URL = process.env.URL || 'http://localhost:4174/';
  const N = +process.env.N || 1000;
  const db = await seededDb();
  const base = db.tables.v2_products.filter((r) => r.data.assessment);
  for (let i = 0; db.tables.v2_products.length < N; i++) {
    const src = base[i % base.length]; const id = `bulk${i}`;
    const data = JSON.parse(JSON.stringify(src.data));
    Object.assign(data, { id, code: `AI-B-${i}`, name: `${src.data.name} ${i}` });
    db.tables.v2_products.push({ ...src, id, code: data.code, name: data.name, data, rev: 0 });
  }
  for (let i = 0; i < 20000; i++) db.tables.v2_audit.push({ id: db.nextId++, at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(), actor: 'client', actor_name: 'Bulk', org: 'northwind', action: 'Check ticked', target: `bulk${i % N}`, detail: 'x' });
  const mb = (JSON.stringify(db.tables.v2_products).length / 1e6).toFixed(1);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await install(ctx, db);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const time = async (fn) => { const t = Date.now(); await fn(); return Date.now() - t; };
  const out = { products: db.tables.v2_products.length, productDataMB: +mb, audit: db.tables.v2_audit.length, ms: {} };
  await p.goto(URL); await p.waitForTimeout(500);
  for (const [who, email] of [['admin', EMAIL.admin], ['client', EMAIL.client]]) {
    out.ms[`${who}: sign in to first screen`] = await time(() => signIn(p, email));
    for (const page of ['dashboard', 'products', 'ops', 'audit', 'cards', 'actions']) {
      if (who === 'client' && ['ops', 'audit'].includes(page)) continue;
      out.ms[`${who}: ${page}`] = await time(async () => { await p.goto(URL + '#' + page); await p.locator('main').getByRole('heading').first().waitFor({ timeout: 60000 }); await p.waitForLoadState('networkidle'); });
    }
    out.ms[`${who}: open a product`] = await time(async () => { const mine = db.tables.v2_products.find((r) => r.id.startsWith('bulk') && r.client_id === 'northwind' && r.data.status === 'Active'); await p.goto(URL + '#product--' + mine.id); await p.getByText(mine.code + ',').first().waitFor({ timeout: 60000 }); });
    if (who === 'client') {
      const box = p.locator('main input[type=checkbox]').first();
      out.ms['client: tick a check until saved'] = await time(async () => { await box.click(); await p.locator('.sync').filter({ hasText: 'Saved' }).waitFor({ timeout: 60000 }); await p.waitForTimeout(50); });
    }
    await p.getByRole('button', { name: /Sign out/ }).first().click(); await p.waitForTimeout(800);
  }
  out.heapMB = +((await p.evaluate(() => performance.memory?.usedJSHeapSize || 0)) / 1e6).toFixed(0);
  out.errors = errs;
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
