// Running it: System health (server check, error reports, backup), a page that fails shows a way out and is
// reported, older audit entries load on request, and the per-organisation AI switch keeps descriptions away from the
// AI service. Cloud build on 4174.
const { chromium } = require('playwright');
const fs = require('node:fs');
const { install, seededDb, signIn, signOut, EMAIL } = require('./fake-supabase.cjs');
const { answerRiskProfile, registerAndOpenControls } = require('./wizard.cjs');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
(async () => {
  const URL = process.env.URL || 'http://localhost:4174/';
  const b = await chromium.launch(); const db = await seededDb(); const errs = [];
  for (let i = 0; i < 1200; i++) db.tables.v2_audit.push({ id: db.nextId++, at: new Date(Date.UTC(2025, 0, 1) + i * 60000).toISOString(), actor: 'client', actor_name: 'Old', org: 'northwind', action: `Old entry ${i}`, target: 'sys-1', detail: '' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); await install(ctx, db);
  let aiCalls = 0;
  await ctx.route('**/api/generate-questions', (route) => { aiCalls++; route.fulfill({ status: 503, body: '{"error":"off in test"}' }); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => { if (!/boom from the test/.test(e.message)) errs.push(e.message); });
  const W = (ms = 500) => p.waitForTimeout(ms);
  const body = () => p.locator('#root').innerText();
  try {
    await p.goto(URL); await W(800); await signIn(p, EMAIL.client);
    // an error on a client's screen is reported (scrubbed), once
    await p.evaluate(() => { setTimeout(() => { throw new Error('boom from the test for priya.nair@example.com'); }, 0); });
    await W(1200);
    assert(db.tables.v2_client_errors.length === 1, 'error reported');
    assert(!db.tables.v2_client_errors[0].message.includes('priya.nair@example.com'), 'email scrubbed from the report');
    await signOut(p);

    await signIn(p, EMAIL.admin);
    await p.goto(URL + '#settings'); await W(1200);
    let t = await body();
    assert(t.includes('System health') && /Up, \d+ ms/.test(t), 'health shown');
    assert(t.includes('boom from the test'), 'error listed for the administrator');
    // backup
    const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Download a full backup' }).click()]);
    const file = await dl.path(); const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert(backup.format === 'governai-backup' && backup.tables.v2_products.length === db.tables.v2_products.length, 'backup has every product');
    assert(backup.tables.v2_audit.length === db.tables.v2_audit.length && backup.tables.v2_ledger.length === db.tables.v2_ledger.length, 'backup has the full audit log and record (paged past 1,000 rows)');
    await p.getByRole('button', { name: 'Clear' }).click(); await W(800);
    assert(db.tables.v2_client_errors.length === 0, 'reports cleared');
    // older audit entries
    await p.goto(URL + '#audit'); await W(800);
    const first = db.tables.v2_audit.length;
    await p.getByRole('button', { name: /Show .* more/ }).click(); await W(300);
    while (await p.getByRole('button', { name: /Show .* more/ }).count()) { await p.getByRole('button', { name: /Show .* more/ }).click(); await W(150); }
    await p.getByRole('button', { name: 'Load older entries' }).click(); await W(1000);
    t = await body();
    assert(new RegExp(`Showing \\d+ of ${first}`).test(t), 'older entries loaded: all ' + first + ' entries now listed');
    // AI off for Northwind
    await p.goto(URL + '#admin'); await W(800);
    await p.getByRole('button', { name: 'AI questions for Northwind Insurance: on' }).click(); await W(800);
    assert(db.tables.v2_clients.find((c) => c.id === 'northwind').ai_questions === false, 'saved per organisation');
    await signOut(p);
    await signIn(p, EMAIL.client);
    await p.goto(URL + '#new'); await W(800);
    await p.fill('input[placeholder="e.g. Claims triage model"]', 'Claims triage assistant');
    await p.fill('input[placeholder="e.g. Claims"]', 'Claims'); await p.fill('input[placeholder="Full name"]', 'Owner Name');
    await p.fill('textarea', 'Sorts incoming claims by urgency so handlers see the urgent ones first.');
    await p.selectOption('#domain', 'insurance'); await p.selectOption('#type', 'ml'); await p.selectOption('#sourcing', 'build');
    const combo = p.getByLabel('Countries'); await combo.click(); await combo.fill('India'); await p.keyboard.press('Enter'); await p.keyboard.press('Escape'); await p.click('h1');
    await p.getByRole('checkbox', { name: 'Personal data', exact: true }).click();
    await p.getByRole('button', { name: 'Continue' }).click(); await W();
    await p.getByRole('button', { name: /Use suggested/ }).click(); await p.getByRole('button', { name: 'Continue' }).click(); await W();
    await answerRiskProfile(p, { idx: 0 });
    const before = aiCalls;
    await p.getByRole('button', { name: 'Continue' }).click(); await W(300);
    await registerAndOpenControls(p);
    assert((await body()).includes('rules engine') || (await p.locator('[role=radio]').count()) > 0, 'questionnaire built without AI');
    assert(aiCalls === before, 'no description sent to the AI service for this organisation');
    assert(!errs.length, 'page errors: ' + errs.join(' | '));
    console.log(JSON.stringify({ ok: true, audit: first }));
  } catch (e) { console.log(JSON.stringify({ ok: false, error: e.message, errs })); process.exitCode = 1; }
  await b.close();
})();
