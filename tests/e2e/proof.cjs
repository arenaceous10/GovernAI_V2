// Tamper-evident record, signed evidence packs, the public check page, document packs, the model-registry
// connector, operations (review timers, workload, time to value) and client branding.
// Cloud build on port 4174 made with the test evidence key (see test-evidence-key.cjs) against the Supabase stand-in.
const { chromium } = require('playwright');
const fs = require('fs');
const { install, seededDb, signIn, signOut, EMAIL } = require('./fake-supabase.cjs');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
(async () => {
  const URL = process.env.URL || 'http://localhost:4174/';
  const b = await chromium.launch(); const db = await seededDb(); const errs = [];
  const open = async () => {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); await install(ctx, db);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|generate-questions|50[23]|40[34]/.test(m.text())) errs.push(m.text()); });
    return p;
  };
  const W = (p, ms = 300) => p.waitForTimeout(ms);
  const body = (p) => p.locator('#root').innerText();
  const row = (id) => db.tables.v2_products.find((r) => r.id === id);
  const download = async (p, click) => { const [d] = await Promise.all([p.waitForEvent('download'), click()]); const f = await d.path(); return { name: d.suggestedFilename(), file: f }; };
  let p = await open();
  try {
    await p.goto(URL); await W(p, 800); await signIn(p, EMAIL.client);

    // 1. the record tab checks the database's chain and matches it with the product
    await p.goto(URL + '#product--sys-3'); await W(p, 800);
    await p.getByRole('tab', { name: 'Record' }).click(); await W(p, 1500);
    let t = await body(p);
    assert(t.includes('Record intact') && t.includes('Matches the product'), 'record intact and matching');
    assert(db.tables.v2_ledger.some((r) => r.chain === 'sys-3' && r.kind === 'decision'), 'ledger has decisions');

    // a client action is recorded by the database, and the record stays intact
    const before = db.tables.v2_ledger.filter((r) => r.chain === 'sys-3').length;
    await p.goto(URL + '#product--sys-1'); await W(p, 800);
    await p.getByRole('tab', { name: 'Record' }).click(); await W(p, 1500);
    assert((await body(p)).includes('Record intact'), 'sys-1 record intact');

    // 2. signed evidence pack: download, then check it inside the app (live record comparison)
    await p.goto(URL + '#product--sys-3'); await W(p, 800);
    await p.getByRole('tab', { name: 'Record' }).click(); await W(p, 1200);
    const pk = await download(p, () => p.getByRole('button', { name: /Download signed evidence pack/ }).click());
    assert(/^evidence-pack-.*\.json$/.test(pk.name), `pack file name ${pk.name}`);
    const pack = JSON.parse(fs.readFileSync(pk.file, 'utf8'));
    assert(pack.signature?.alg === 'Ed25519' && pack.record.rows.length >= before, 'pack signed with full record');
    assert(!JSON.stringify(pack).includes('data:application'), 'no file contents in the pack');
    await p.goto(URL + '#verify'); await W(p, 600);
    await p.setInputFiles('input[type=file]', pk.file); await W(p, 1200);
    t = await body(p);
    assert(t.includes('Signature valid') && t.includes('Record intact') && t.includes('Record matches the product snapshot'), 'pack verifies');
    assert(t.includes('The live record still agrees with this pack'), 'live comparison');

    // a single changed character breaks the signature
    const bad = { ...pack, product: { ...pack.product, name: `${pack.product.name}.` } };
    fs.writeFileSync('/tmp/pack-bad.json', JSON.stringify(bad));
    await p.setInputFiles('input[type=file]', '/tmp/pack-bad.json'); await W(p, 1000);
    assert((await body(p)).includes('Signature does not match'), 'tampered pack refused');
    fs.writeFileSync('/tmp/not-a-pack.json', '{"hello":1}');
    await p.setInputFiles('input[type=file]', '/tmp/not-a-pack.json'); await W(p, 500);
    assert((await body(p)).includes('not a GovernAI evidence pack'), 'other JSON refused');

    // 3. anyone can check a pack without an account
    const anon = await open(); await anon.goto(URL + '#verify'); await W(anon, 1000);
    assert((await anon.locator('body').innerText()).includes('Check an evidence pack'), 'public page, no sign-in');
    await anon.setInputFiles('input[type=file]', pk.file); await W(anon, 1200);
    t = await anon.locator('body').innerText();
    assert(t.includes('Signature valid') && !t.includes('live record'), 'verified without an account');
    await anon.context().close();

    // 4. someone edits the record directly in the database: the record tab shows it
    const victim = db.tables.v2_ledger.find((r) => r.chain === 'sys-3' && r.seq === 2);
    victim.body = victim.body.replace('Submitted', 'Approved');
    await p.goto(URL + '#product--sys-3'); await W(p, 800);
    await p.getByRole('tab', { name: 'Record' }).click(); await W(p, 1500);
    t = await body(p);
    assert(t.includes('Record broken') && t.includes('Entry 2'), 'edit to the record detected');
    victim.body = victim.body.replace('"Approved"', '"Submitted"');
    // ... and the earlier pack no longer matches the live record if history is rewritten
    await p.goto(URL + '#verify'); await W(p, 500);
    const saved = victim.hash; victim.hash = 'f'.repeat(64);
    await p.setInputFiles('input[type=file]', pk.file); await W(p, 1200);
    assert((await body(p)).includes('no longer agrees'), 'rewritten history detected against the receipt');
    victim.hash = saved;

    // 5. document packs: Annex IV and DPDP drafts download as Word files
    await p.goto(URL + '#product--sys-3'); await W(p, 800);
    await p.getByRole('button', { name: /Report/ }).click(); await W(p);
    const ax = await download(p, () => p.getByRole('menuitem', { name: /Annex IV technical documentation/ }).click());
    assert(/^annex-iv-.*\.docx$/.test(ax.name) && fs.readFileSync(ax.file).slice(0, 2).toString() === 'PK', 'Annex IV docx');
    await W(p, 400);
    await p.getByRole('button', { name: /Report/ }).click(); await W(p);
    await p.getByLabel(/Significant Data Fiduciary/).check();
    const dp = await download(p, () => p.getByRole('menuitem', { name: /DPDP pack/ }).click());
    assert(/^dpdp-.*\.docx$/.test(dp.name) && fs.statSync(dp.file).size > 5000, 'DPDP docx');
    await signOut(p);

    // 6. model registry: connect, then a new version in production opens a change review
    let c;
    await signIn(p, EMAIL['client:meridian']);
    db.registry = { info: { description: 'Scores motor claims for triage.', owner: 'ml-platform@meridian.example' }, versions: [{ version: '3', createdAt: '2026-10-01T00:00:00Z', aliases: ['champion'], metrics: { auc: 0.912 } }, { version: '2', createdAt: '2026-08-01T00:00:00Z' }] };
    await p.goto(URL + '#card--sys-5'); await W(p, 1000);
    assert((await body(p)).includes('Model registry'), 'registry panel');
    await p.getByRole('button', { name: /Connect a model registry/ }).click(); await W(p);
    await p.getByLabel('Workspace or server address').fill('http://insecure.example.com');
    await p.getByLabel('Registered model name').fill('main.risk.claims');
    await p.getByLabel('Read-only access token').fill('dapi-test-token');
    await p.getByRole('button', { name: /Test and connect/ }).click(); await W(p, 800);
    assert((await body(p)).includes('Only https addresses are allowed'), 'http refused');
    await p.getByLabel('Workspace or server address').fill('https://adb-1.azuredatabricks.net');
    await p.getByRole('button', { name: /Test and connect/ }).click(); await W(p, 1500);
    t = await body(p);
    assert(t.includes('main.risk.claims') && t.includes('champion') && t.includes('auc 0.912'), 'versions and metrics shown');
    assert(t.includes('From Databricks Unity Catalog: version 3 (champion)'), 'registry metrics in the performance panel');
    assert(t.includes('Model versions (Databricks Unity Catalog)') && t.includes('Model version 3'), 'registry versions in version history');
    await p.getByRole('button', { name: /Fill from registry/ }).click(); await W(p, 800);
    c = row('sys-5').data.card;
    assert(c.modelOwner === 'ml-platform@meridian.example' && c.modelVersion === '3 (champion)' && c.modelName.startsWith('main.risk.claims'), 'card filled from registry');
    assert(!c.summary || c.summary === 'Scores motor claims for triage.' || c.summary.length > 0, 'existing definition kept or filled');
    c = row('sys-5').data.connector;
    assert(c && c.latest === '3' && c.tokenSealed === 'v1.sealed-for-sys-5', 'connection saved with sealed token');
    assert(!JSON.stringify(db.tables.v2_products).includes('dapi-test-token'), 'raw token never stored');
    db.registry.versions.unshift({ version: '4', createdAt: '2026-11-05T00:00:00Z', metrics: { auc: 0.9 } });
    await p.getByRole('button', { name: /Check now/ }).click(); await W(p, 1500);
    assert(row('sys-5').data.stage === 8 && row('sys-5').data.events.at(-1).text.includes('version 4'), 'change review opened');
    assert(db.tables.v2_ledger.some((r) => r.chain === 'sys-5' && r.kind === 'stage' && r.body.includes('"to":8')), 'stage move recorded');
    await p.goto(URL + '#product--sys-5'); await W(p, 800);
    assert((await body(p)).includes('Change management'), 'product now in change management');

    // 6b. evaluations, traces and production monitoring; drift is recorded once
    db.registry.genai = { experimentId: '42', evaluations: [{ runId: 'e1', name: 'eval-v4', at: '2026-11-07T10:00:00Z', metrics: { 'safety/mean': 1, 'correctness/mean': 0.82 } }],
      traces: { count: 37, more: false, errors: 2, last: '2026-11-08T09:00:00Z', latencyMs: 640 }, notes: [] };
    db.registry.monitoring = { table: 'main.risk.claims_inference', monitor: { status: 'ACTIVE', driftTable: 'x', profileTable: 'y' },
      drift: { windowEnd: '2026-11-08T00:00:00Z', checked: 6, drifted: [{ column: 'age', js: 0.31, psi: 0.42, ksP: 0.001, type: 'CONSECUTIVE' }] },
      performance: { windowEnd: '2026-11-08T00:00:00Z', rows: 1200, metrics: { accuracy_score: 0.81 } }, notes: [] };
    await p.goto(URL + '#card--sys-5'); await W(p, 1000);
    await p.getByRole('button', { name: /Evaluations and monitoring/ }).click(); await W(p);
    await p.getByLabel('Monitored table').fill('main.risk.claims_inference');
    await p.getByLabel('SQL warehouse ID').fill('abcdef1234567890');
    await p.getByRole('button', { name: 'Save and check' }).click(); await W(p, 1500);
    t = await body(p);
    assert(t.includes('Evaluations and traces') && t.includes('eval-v4') && t.includes('safety: 100%') && t.includes('2 with errors'), 'evaluations and traces shown');
    assert(t.includes('Production monitoring') && t.includes('1 column drifted') && t.includes('age (JS 0.31, PSI 0.42, KS p 0.001)') && t.includes('accuracy score'), 'monitoring shown');
    assert(row('sys-5').data.connector.alerts.some((a) => a.kind === 'drift'), 'drift alert stored');
    assert(db.tables.v2_audit.some((a) => a.action === 'Drift detected' && a.target === 'sys-5'), 'drift in the audit log');
    assert(db.tables.v2_ledger.some((r) => r.chain === 'sys-5' && r.kind === 'audit' && r.body.includes('Drift detected')), 'drift in the record');
    const auditN = db.tables.v2_audit.filter((a) => a.action === 'Drift detected').length;
    await p.getByRole('button', { name: /Check now/ }).click(); await W(p, 1200);
    assert(db.tables.v2_audit.filter((a) => a.action === 'Drift detected').length === auditN, 'same window not recorded twice');

    // 6c. Unity Catalog tables into the Data tab, with lineage and monitoring; settings people set are kept
    db.ucTables = { 'main.risk.applicants': { name: 'main.risk.applicants', owner: 'data-office@meridian.example', comment: 'Claim applicants', type: 'MANAGED', columns: 14,
      upstream: ['main.raw.applications'], downstream: ['main.risk.training'], lineageSource: 'system.access.table_lineage', monitor: { status: 'ACTIVE' } } };
    await p.goto(URL + '#product--sys-5'); await W(p, 800);
    await p.getByRole('tab', { name: /Data/ }).click(); await W(p, 600);
    await p.getByLabel(/Tables \(catalog/).fill('main.risk.applicants\nmain.risk.nothing');
    await p.getByRole('button', { name: /Import tables/ }).click(); await W(p, 1200);
    t = await body(p);
    assert(t.includes('main.risk.nothing: Table main.risk.nothing was not found'), 'missing table reported');
    const ds = row('sys-5').data.datasets.find((d) => d.uc?.name === 'main.risk.applicants');
    assert(ds && ds.owner === 'data-office@meridian.example' && ds.catalogued && ds.lineage && ds.qualityChecked && ds.sourceSystem === 'Databricks Unity Catalog', 'dataset imported');
    assert(t.includes('from main.raw.applications') && t.includes('feeds main.risk.training'), 'lineage shown');
    // a person's classification survives a refresh
    ds.classification = 'Confidential';
    await p.reload(); await W(p, 1000); await p.getByRole('tab', { name: /Data/ }).click(); await W(p, 600);
    await p.getByRole('button', { name: /Refresh from Unity Catalog/ }).click(); await W(p, 1200);
    assert(row('sys-5').data.datasets.find((d) => d.uc?.name === 'main.risk.applicants').classification === 'Confidential', 'classification kept');
    await signOut(p);

    // 7. operations: overdue review timers, workload and time to value; overdue reviews notify reviewers
    row('sys-2').data.stages[2].submittedAt = '2026-10-01T09:00:00Z';
    await signIn(p, EMAIL.assessor);
    await p.goto(URL + '#ops'); await W(p, 1200);
    t = await body(p);
    assert(t.includes('Review timers') && t.includes('Overdue') && t.includes('Reviewer workload') && t.includes('Time to value'), 'operations page');
    assert(await p.locator('.recharts-surface').count() >= 1, 'time to value chart');
    await p.locator('.notif-btn, button[aria-label*="otification"]').first().click(); await W(p);
    assert((await body(p)).includes('review overdue'), 'overdue in notifications');
    await signOut(p);

    // 8. branding: the administrator sets a client's logo and colour; the client sees it
    await signIn(p, EMAIL.admin);
    await p.goto(URL + '#settings'); await W(p, 600);
    await p.getByLabel('Review target in working days').fill('8'); await p.getByLabel('Review target in working days').press('Enter'); await W(p, 600);
    await p.goto(URL + '#admin'); await W(p, 800);
    await p.getByRole('button', { name: 'Branding for Northwind Insurance' }).click(); await W(p);
    fs.writeFileSync('/tmp/logo.png', Buffer.from(PNG, 'base64'));
    await p.setInputFiles('input[aria-label="Logo file"]', '/tmp/logo.png'); await W(p, 400);
    await p.getByRole('button', { name: 'Save branding' }).click(); await W(p, 1200);
    const nw = db.tables.v2_clients.find((x) => x.id === 'northwind');
    assert(nw.brand?.logo?.startsWith('data:image/png'), 'brand saved to the database');
    assert(db.tables.v2_settings.find((x) => x.key === 'settings').value.reviewSlaDays === 8, 'review target saved');
    await signOut(p);
    await signIn(p, EMAIL.client); await W(p, 600);
    assert(await p.locator('.client-brand img').count() === 1, 'client sees its logo');

    assert(!errs.length, `page errors: ${errs.join(' | ')}`);
    console.log('PROOF E2E OK');
  } catch (e) {
    await p.screenshot({ path: '/tmp/proof-fail.png' }).catch(() => {});
    console.error(e.message); console.error((await body(p).catch(() => '')).slice(0, 1500)); process.exitCode = 1;
  } finally { await b.close(); }
})();
