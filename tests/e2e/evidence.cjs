// Evidence files: a client uploads, a reviewer opens it, replace and remove work, errors show.
// Local:  npx vite preview --port 4173            then  node tests/e2e/evidence.cjs
// Cloud:  build with the fake Supabase URL (see README), preview on 4174, then CLOUD=1 node tests/e2e/evidence.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { install, newDb } = require('./fake-supabase.cjs');
const CLOUD = process.env.CLOUD === '1';
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

(async () => {
  const URL = process.env.URL || (CLOUD ? 'http://localhost:4174/' : 'http://localhost:4173/');
  const db = newDb();
  db.fixtures = { 'Model_card_v1_final_.txt': 'MODEL-CARD-CONTENT-123', 'model-card-v2.txt': 'SECOND-VERSION-456' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
  const fileA = path.join(dir, 'Model card v1 (final).txt'); fs.writeFileSync(fileA, 'MODEL-CARD-CONTENT-123');
  const fileB = path.join(dir, 'model-card-v2.txt'); fs.writeFileSync(fileB, 'SECOND-VERSION-456');
  const big = path.join(dir, 'too-big.bin'); fs.writeFileSync(big, Buffer.alloc((CLOUD ? 11 : 3) * 1024 * 1024));

  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  if (CLOUD) await install(ctx, db);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  const W = (ms = 200) => p.waitForTimeout(ms);
  const body = () => p.locator('#root').innerText();
  const role = async (v) => { await p.selectOption('select[aria-label="Switch role"]', v); await W(); };
  const openProduct = async (name) => { await p.goto(URL + '#products'); await W(300); await p.getByText(name).first().click(); await W(300); await p.getByRole('tab', { name: 'Lifecycle' }).click(); await W(); };
  const row = (item) => p.locator('.ev-row', { hasText: item }).first();
  // Reads what the new tab shows after clicking a file link.
  const openAndRead = async (locator) => {
    const [tab] = await Promise.all([ctx.waitForEvent('page'), locator.click()]);
    await tab.waitForLoadState().catch(() => {}); await tab.waitForTimeout(600);
    const u = tab.url(); const text = await tab.evaluate(() => document.body?.innerText || '').catch(() => '');
    await tab.close(); return { u, text };
  };

  await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload(); await W(CLOUD ? 1200 : 300);
  await p.getByRole('radio', { name: /Client portal/ }).click(); await p.getByRole('button', { name: 'Enter GovernAI', exact: true }).click(); await W(400);

  await openProduct('Motor claims triage model');
  const items = await p.locator('.ev-row').allInnerTexts();
  const target = items.map((t) => t.split('\n')[0]).find((t, i) => /Not attached/.test(items[i]));
  assert(target, 'an unattached evidence item exists');
  const r = row(target);

  // too big
  await r.getByRole('button', { name: 'Attach' }).click();
  await r.locator('input[type=file]').setInputFiles(big); await W(800);
  assert(/larger than/.test(await r.innerText()), 'size limit message');

  // upload A
  await r.locator('input[type=file]').setInputFiles(fileA); await W(CLOUD ? 1200 : 600);
  let t = await r.innerText();
  assert(/Attached/.test(t) && t.includes('Model card v1 (final).txt'), 'uploaded file listed: ' + t);
  if (CLOUD) { const keys = Object.keys(db.files); assert(keys.length === 1 && /stage-4\/.+Model_card_v1_final_.txt$/.test(keys[0]), 'stored in bucket ' + keys); }

  // client can open it
  let o = await openAndRead(r.getByRole('button', { name: /Model card v1/ }));
  assert(o.text.includes('MODEL-CARD-CONTENT-123'), 'client opens file: ' + o.u);

  // add a link alongside
  await r.getByRole('button', { name: 'Change' }).click();
  await r.getByLabel(/Link or document name/).fill('https://example.com/model-card');
  await r.getByRole('button', { name: 'Save', exact: true }).click(); await W(CLOUD ? 900 : 300);
  t = await r.innerText(); assert(t.includes('Model card v1') && t.includes('https://example.com/model-card'), 'file kept when link added');
  assert(await r.locator('a[href="https://example.com/model-card"]').count() === 1, 'link is clickable');

  // reviewer sees and opens it (cloud: from a fresh browser to prove it is shared)
  let rp = p;
  if (CLOUD) {
    await W(1500);
    const ctx2 = await b.newContext({ viewport: { width: 1280, height: 860 } }); await install(ctx2, db);
    rp = await ctx2.newPage(); rp.on('pageerror', (e) => errs.push('pageerror2: ' + e.message));
    await rp.goto(URL); await rp.waitForTimeout(1500);
    await rp.getByRole('radio', { name: /Governance team/ }).click(); await rp.getByRole('button', { name: 'Enter GovernAI', exact: true }).click(); await rp.waitForTimeout(500);
    await rp.goto(URL + '#products'); await rp.waitForTimeout(400); await rp.getByText('Motor claims triage model').first().click(); await rp.waitForTimeout(300);
    await rp.getByRole('tab', { name: 'Lifecycle' }).click(); await rp.waitForTimeout(300);
    const rr = rp.locator('.ev-row', { hasText: target }).first();
    const [tab] = await Promise.all([ctx2.waitForEvent('page'), rr.getByRole('button', { name: /Model card v1/ }).click()]);
    await tab.waitForTimeout(800); const tx = await tab.evaluate(() => document.body.innerText);
    assert(tx.includes('MODEL-CARD-CONTENT-123'), 'reviewer in another browser opens file');
    await ctx2.close();
  } else {
    await role('assessor'); await openProduct('Motor claims triage model');
    o = await openAndRead(row(target).getByRole('button', { name: /Model card v1/ }));
    assert(o.text.includes('MODEL-CARD-CONTENT-123'), 'reviewer opens file');
    await role('client:northwind'); await openProduct('Motor claims triage model');
  }

  // seeded evidence without a stored file says so instead of pretending
  assert(/no file uploaded/.test(await body()) || /SharePoint/.test(await body()), 'seed evidence labelled');

  // replace with B: old file removed from storage
  await row(target).getByRole('button', { name: 'Change' }).click();
  await row(target).locator('input[type=file]').setInputFiles(fileB); await W(CLOUD ? 1200 : 600);
  t = await row(target).innerText(); assert(t.includes('model-card-v2.txt') && !t.includes('Model card v1'), 'replaced');
  if (CLOUD) { await W(500); const keys = Object.keys(db.files); assert(keys.length === 1 && /model-card-v2/.test(keys[0]), 'old file deleted ' + keys); }
  o = await openAndRead(row(target).getByRole('button', { name: /model-card-v2/ }));
  assert(o.text.includes('SECOND-VERSION-456'), 'opens replaced file');

  // storage failure shows a message and keeps the old file
  if (CLOUD) {
    db.failStorage = true;
    await row(target).getByRole('button', { name: 'Change' }).click();
    await row(target).locator('input[type=file]').setInputFiles(fileA); await W(1200);
    assert(/storage down|failed/i.test(await row(target).innerText()), 'upload error shown');
    await row(target).getByRole('button', { name: 'Cancel' }).click();
    assert((await row(target).innerText()).includes('model-card-v2.txt'), 'old file kept after failed upload');
    db.failStorage = false;
  }

  // persists after reload
  await W(CLOUD ? 1500 : 300); await p.reload(); await W(CLOUD ? 1500 : 400);
  await openProduct('Motor claims triage model');
  assert((await row(target).innerText()).includes('model-card-v2.txt'), 'evidence survives reload');

  // remove
  await row(target).getByRole('button', { name: /Remove evidence/ }).click(); await W(CLOUD ? 900 : 300);
  assert(/Not attached/.test(await row(target).innerText()), 'removed');
  if (CLOUD) assert(Object.keys(db.files).length === 0, 'file deleted from storage');

  // mobile: no horizontal overflow on lifecycle with long names
  await row(target).getByRole('button', { name: 'Attach' }).click();
  await row(target).getByLabel(/Link or document name/).fill('https://example.com/' + 'very-long-path-segment/'.repeat(8));
  await row(target).getByRole('button', { name: 'Save', exact: true }).click(); await W(400);
  await p.setViewportSize({ width: 390, height: 800 }); await W(300);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(over <= 1, 'mobile overflow ' + over);
  await p.screenshot({ path: path.join(dir, 'mobile.png'), fullPage: true });

  assert(errs.length === 0, errs.join('\n'));
  console.log(`EVIDENCE ${CLOUD ? 'CLOUD' : 'LOCAL'} OK (${target})`);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
