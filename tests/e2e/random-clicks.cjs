const { chromium } = require('playwright');
const { install, newDb } = require('./fake-supabase.cjs');
const CLOUD = process.env.CLOUD === '1';
(async () => {
  const URL = CLOUD ? 'http://localhost:4174/' : 'http://localhost:4173/'; const seed0 = +process.argv[2] || 1; const runs = +process.argv[3] || 1;
  let s = seed0; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const b = await chromium.launch(); const errs = []; let clicks = 0;
  for (let run = 0; run < runs; run++) {
    const ctx = await b.newContext({ viewport: { width: rnd() < 0.25 ? 820 : 1440, height: 900 } }); if (CLOUD) await install(ctx, newDb());
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`run${run} pageerror: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error' && !/generate-questions|501|404|Failed to load resource/.test(m.text())) errs.push(`run${run} console: ${m.text()}`); });
    p.on('dialog', d => d.dismiss());
    await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload(); if (CLOUD) await p.waitForTimeout(700);
    const roles = ['client:northwind', 'client:meridian', 'client:lotus', 'assessor', 'lead', 'admin'];
    await p.click('.entry-card >> nth=0'); await p.getByRole('button', { name: 'Enter GovernAI' }).click();
    for (const r of roles.sort(() => rnd() - 0.5)) {
      await p.selectOption('select[aria-label="Switch role"]', r).catch(() => {});
      await p.waitForTimeout(80);
      const navs = await p.locator('nav.nav button').all();
      for (let n = 0; n < navs.length; n++) {
        await p.locator('nav.nav button').nth(n).click().catch(() => {}); await p.waitForTimeout(60);
        for (let k = 0; k < 14; k++) {
          const els = await p.locator('main button:visible:not([disabled]), main [role=radio]:visible, main [role=checkbox]:visible, main input[type=checkbox]:visible:not([disabled]), main select:visible:not([disabled]), main tr.click:visible').all();
          if (!els.length) break;
          const el = els[Math.floor(rnd() * els.length)];
          const tag = await el.evaluate(e => e.tagName).catch(() => '');
          const txt = (await el.innerText().catch(() => '')) || '';
          if (/Sign out/.test(txt)) continue;
          try {
            if (tag === 'SELECT') { const opts = await el.locator('option').all(); if (opts.length) { const v = await opts[Math.floor(rnd() * opts.length)].getAttribute('value'); await el.selectOption(v ?? undefined, { timeout: 1500 }); } }
            else await el.click({ timeout: 1500 });
            clicks++;
          } catch { /* element went away: fine */ }
          await p.waitForTimeout(25);
          const filled = await p.locator('#root').innerText().catch(() => '');
          if (!filled.trim()) { errs.push(`run${run} BLANK SCREEN after "${txt.slice(0, 40)}" as ${r}`); break; }
        }
      }
    }
    await ctx.close();
  }
  console.log(JSON.stringify({ runs, clicks, errors: [...new Set(errs)].slice(0, 20) }));
  await b.close();
})();
