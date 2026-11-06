// Contrast audit: visits every page and product tab as each role and flags text whose
// colour is too close to the background behind it (WCAG ratio below 3:1).
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:4173/';

const AUDIT = () => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(s => parseFloat(s)); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
  const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = el => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage && s.backgroundImage !== 'none' && /gradient|url/.test(s.backgroundImage)) {
        // gradients: sample the first opaque-ish colour stop as an approximation
        const stops = [...s.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map(m => parse(m[0])).filter(c => c && c.a > 0.6);
        if (stops.length) { layers.push(stops[stops.length - 1]); break; }
      }
      const c = parse(s.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let out = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out);
    return out;
  };
  const bad = [];
  const walker = document.createTreeWalker(document.querySelector('#root'), NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode; const txt = t.textContent.trim(); if (!txt) continue;
    const el = t.parentElement; if (seen.has(el)) continue; seen.add(el);
    const s = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (!r.width || !r.height || s.visibility === 'hidden' || +s.opacity === 0) continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity; if (op < 0.2) continue;
    const fg0 = parse(s.color); if (!fg0) continue; const bg = bgOf(el); const fg = blend(fg0, bg);
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    if (ratio < 3) bad.push({ text: txt.slice(0, 40), cls: (el.className && el.className.baseVal === undefined ? el.className : '') + ' <' + el.tagName.toLowerCase() + '> in .' + ((el.closest('[class]:not(' + el.tagName + ')') || {}).className || ''), ratio: +ratio.toFixed(2), fg: s.color, bg: `rgb(${bg.r | 0},${bg.g | 0},${bg.b | 0})` });
  }
  return bad;
};

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  const found = new Map();
  const record = async where => { await p.waitForTimeout(450); for (const x of await p.evaluate(AUDIT)) { const k = x.text + '|' + x.cls; if (!found.has(k)) found.set(k, { ...x, where }); } };
  await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload();
  await record('landing');
  await p.click('.entry-card >> nth=0'); await p.getByRole('button', { name: 'Enter GovernAI' }).click();
  for (const r of ['client:northwind', 'assessor', 'lead', 'admin']) {
    await p.selectOption('select[aria-label="Switch role"]', r).catch(() => {}); await p.waitForTimeout(200);
    const n = await p.locator('nav.nav button').count();
    for (let i = 0; i < n; i++) {
      const nav = p.locator('nav.nav button').nth(i); const name = (await nav.innerText()).split('\n')[0];
      await nav.click(); await record(`${r} / ${name}`);
      // open the first product on this page, if any, and walk its tabs
      const prod = p.locator('main tr.click, main .board-card, main .review-item, main .prod-card').first();
      if (await prod.count() && /Dashboard|Products|Reviews|Systems|Home/i.test(name)) {
        await prod.click().catch(() => {}); await record(`${r} / ${name} / product`);
        const tabs = await p.locator('main .tabs button').count();
        for (let t = 0; t < tabs; t++) { const tb = p.locator('main .tabs button').nth(t); const tn = await tb.innerText(); await tb.click(); await record(`${r} / product / ${tn}`); }
        await nav.click();
      }
    }
  }
  console.log(JSON.stringify([...found.values()], null, 1));
  await b.close();
})();
