const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
(async () => {
  const URL = 'http://localhost:4173/';
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const body = () => p.locator('#root').innerText(); const W = (ms = 150) => p.waitForTimeout(ms);
  const btn = (n) => p.getByRole('button', { name: n, exact: true });
  await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.getByRole('radio', { name: /Governance team/ }).click(); await p.getByRole('radio', { name: 'Governance reviewer' }).click(); await btn('Enter GovernAI').click(); await W();
  // draft: save then continue
  await p.goto(URL + '#new'); await W();
  await p.fill('input[placeholder="e.g. Claims triage model"]', 'Draft product X'); await btn('Save draft').click(); await W();
  assert((await body()).includes('Draft saved'), 'draft saved');
  await p.goto(URL + '#products'); await W(); assert((await body()).includes('Draft product X'), 'draft listed');
  await btn('Continue').click(); await W(); assert(await p.inputValue('input[placeholder="e.g. Claims triage model"]') === 'Draft product X', 'draft restored');
  // re-assess keeps stage, changes score
  await p.goto(URL + '#product--sys-1'); await W(); await p.getByRole('tab', { name: 'Assessment' }).click(); await btn('Re-assess').click(); await W();
  for (let i = 0; i < 3; i++) { await btn("Continue").click(); await W(400); }
  for (let k = 0; k < 8; k++) { for (const lad of await p.locator('.ladder').all()) await lad.locator('[role=radio]').nth(3).click(); const nx = btn('Next section'); if (await nx.count()) await nx.click(); else break; }
  await btn('Continue').click(); await W(); await btn('Save re-assessment').click(); await W(300);
  const t = await body(); assert(t.includes('Stage 4 of 10'), 'stage kept after re-assess'); assert(/100%\s*\n?\s*Controls in place/.test(t) || t.includes('100%'), 'controls 100% after best answers');
  // mobile
  await p.setViewportSize({ width: 390, height: 844 }); await p.goto(URL + '#dashboard'); await W(300);
  const over = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  await p.screenshot({ path: './e2e-shots/21-mobile.png' });
  await p.goto(URL + '#product--sys-1'); await W(); await p.getByRole('tab', { name: 'Lifecycle' }).click(); await W(); await p.screenshot({ path: './e2e-shots/22-mobile-lifecycle.png', fullPage: true });
  const over2 = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  console.log(JSON.stringify({ ok: true, overflow: [over, over2], errors: errs }));
  await b.close();
})().catch((e) => { console.log(JSON.stringify({ ok: false, error: e.message })); process.exit(1); });
