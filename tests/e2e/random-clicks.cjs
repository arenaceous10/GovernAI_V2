const { chromium } = require('playwright');
const { install, seededDb, signIn, signOut, EMAIL } = require('./fake-supabase.cjs');
const CLOUD = process.env.CLOUD === '1';
(async () => {
  const URL = CLOUD ? 'http://localhost:4174/' : 'http://localhost:4173/'; const seed0 = +process.argv[2] || 1; const runs = +process.argv[3] || 1;
  let s = seed0; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const b = await chromium.launch(); const errs = []; let clicks = 0;
  for (let run = 0; run < runs; run++) {
    const ctx = await b.newContext({ viewport: { width: rnd() < 0.25 ? 820 : 1440, height: 900 } }); if (CLOUD) await install(ctx, await seededDb());
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`run${run} pageerror: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error' && !/generate-questions|501|404|Failed to load resource/.test(m.text())) errs.push(`run${run} console: ${m.text()}`); });
    p.on('dialog', d => d.dismiss());
    await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload(); if (CLOUD) await p.waitForTimeout(700);
    const roles = ['client:northwind', 'client:meridian', 'client:lotus', 'assessor', 'lead', 'admin'];
    if (!CLOUD) { await p.click('.entry-card >> nth=0'); await p.getByRole('button', { name: 'Enter GovernAI' }).click(); }
    let first = true;
    for (const r of roles.sort(() => rnd() - 0.5)) {
      if (CLOUD) {
        if (!first) await signOut(p).catch(async () => { await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload(); });
        await p.goto(URL + '#dashboard'); first = false;
        try { await signIn(p, EMAIL[r]); } catch (e) {
          // the random admin clicks may have turned this account off or changed it: that is correct behaviour
          const txt = await p.locator('#root').innerText();
          if (/Access turned off|Waiting for approval/.test(txt)) { await p.getByRole('button', { name: /Sign out/ }).click(); await p.waitForTimeout(300); continue; }
          errs.push(`run${run} sign-in as ${r} failed: ${txt.slice(0, 120)}`); break;
        }
        if (await p.locator('select[aria-label="Switch role"]').count()) errs.push('role switcher visible when signed in');
      } else await p.selectOption('select[aria-label="Switch role"]', r).catch(() => {});
      await p.waitForTimeout(80);
      const navs = await p.locator('nav.nav button').all();
      for (let n = 0; n < navs.length; n++) {
        await p.locator('nav.nav button').nth(n).click().catch(() => {}); await p.waitForTimeout(60);
        for (let k = 0; k < 14; k++) {
          const els = await p.locator('main button:visible:not([disabled]), main [role=radio]:visible, main [role=checkbox]:visible, main input[type=checkbox]:visible:not([disabled]), main select:visible:not([disabled]), main tr.click:visible, main input:not([type]):visible:not([disabled]), main input[type=text]:visible:not([disabled]), main input[type=number]:visible:not([disabled]), main input[type=date]:visible:not([disabled]), main textarea:visible:not([disabled])').all();
          if (!els.length) break;
          const el = els[Math.floor(rnd() * els.length)];
          const tag = await el.evaluate(e => e.tagName).catch(() => '');
          const txt = (await el.innerText().catch(() => '')) || '';
          if (/Sign out/.test(txt)) continue;
          try {
            const type = await el.getAttribute('type').catch(() => '');
            if (tag === 'TEXTAREA' || (tag === 'INPUT' && type !== 'checkbox')) {
              const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
              const v = type === 'number' ? pick(['0', '-5', '99999', '3.5', '']) : type === 'date' ? pick(['2026-12-01', '2020-01-01', '']) : pick(['<img src=x onerror=alert(1)>', 'x'.repeat(5000), 'Ünïcødé 名前 🚀', '   ', 'The vendor contract covers this control fully.', "'; drop table x; --", '{{7*7}}', '']);
              await el.fill(v, { timeout: 1500 });
            } else if (tag === 'SELECT') { const opts = await el.locator('option').all(); if (opts.length) { const v = await opts[Math.floor(rnd() * opts.length)].getAttribute('value'); await el.selectOption(v ?? undefined, { timeout: 1500 }); } }
            else await el.click({ timeout: 1500 });
            clicks++;
          } catch { /* element went away: fine */ }
          await p.waitForTimeout(25);
          const filled = await p.locator('#root').innerText().catch(() => '');
          if (!filled.trim()) { errs.push(`run${run} BLANK SCREEN after "${txt.slice(0, 40)}" as ${r}`); break; }
          const odd = filled.replaceAll('Kept, period undefined', '').match(/.{0,50}(\bNaN\b|\bundefined\b|\[object Object\]|Invalid Date|\bnull\b(?! hypothesis)).{0,30}/);
          if (odd) errs.push(`run${run} odd text as ${r} on ${await p.evaluate(() => location.hash)}: ${odd[0].replace(/\s+/g, ' ')}`);
          if (await p.locator('img[src="x"]').count()) errs.push(`run${run} injected HTML rendered as ${r}`);
        }
      }
    }
    await ctx.close();
  }
  console.log(JSON.stringify({ runs, clicks, errors: [...new Set(errs)].slice(0, 20) }));
  await b.close();
})();
