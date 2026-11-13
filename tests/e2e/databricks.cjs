// What GovernAI reads from Databricks about a model, on the screens: how the version was made, the tables it was
// trained on, personal-data tags, evidence attached automatically with its read date, and what happens when that
// read goes out of date.
// Cloud build on port 4174 against the Supabase stand-in (see proof.cjs for how it is built and served).
const { chromium } = require('playwright');
const { install, seededDb, signIn, signOut, EMAIL } = require('./fake-supabase.cjs');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
(async () => {
  const URL = process.env.URL || 'http://localhost:4174/';
  const b = await chromium.launch(); const db = await seededDb(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await install(ctx, db);
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|generate-questions|50[23]|40[34]/.test(m.text())) errs.push(m.text()); });
  const W = (ms = 300) => p.waitForTimeout(ms);
  const body = () => p.locator('#root').innerText();
  const row = (id) => db.tables.v2_products.find((r) => r.id === id);
  const ID = 'sys-1';   // Motor claims triage model, Northwind, stage 4 (Design and development), in progress
  const ITEM = 'Configuration and version records';
  const evRow = () => p.locator('.ev-row', { hasText: ITEM });
  try {
    assert(row(ID).data.stage === 4 && (row(ID).data.stages?.[4]?.status || 'open') === 'open', 'the test product is at stage 4, in progress');
    db.registry = {
      info: { description: 'Routes motor claims.', owner: 'ml-platform@northwind.example' },
      versions: [
        { version: '3', createdAt: '2026-11-01T00:00:00Z', aliases: ['champion'], runId: 'r3', metrics: { auc: 0.912, f1: 0.71 },
          run: { startedAt: '2026-10-31T09:00:00Z', user: 'ds@northwind.example', code: { commit: '1a2b3c4d5e6f7a8b', source: '/Repos/claims/train_triage', branch: 'main', repo: '' }, flavors: ['sklearn'], params: { max_depth: '6', n_estimators: '200' },
            datasets: [{ name: 'main.claims.fnol@v12', table: 'main.claims.fnol', digest: 'ab12cd34', context: 'training' }, { name: 'frame', table: null, digest: 'x', context: '' }] },
          dependencies: { tables: ['main.claims.features'], functions: [] } },
        { version: '2', createdAt: '2026-08-01T00:00:00Z', runId: 'r2', metrics: { auc: 0.9, f1: 0.75 },
          run: { startedAt: '2026-07-31T09:00:00Z', code: { commit: '0000aaaa' }, flavors: ['sklearn'], params: { max_depth: '4', n_estimators: '200' }, datasets: [{ name: 'main.claims.fnol@v9', table: 'main.claims.fnol', digest: 'old00001', context: 'training' }] } },
      ],
    };
    db.ucTables = {
      'main.claims.fnol': { name: 'main.claims.fnol', owner: 'claims-data@northwind.example', comment: 'First notice of loss', type: 'MANAGED', columns: 22, upstream: ['main.raw.claimcenter'], downstream: [], lineageSource: 'system.access.table_lineage', monitor: null,
        personal: { tagsRead: true, tagged: [{ column: 'claimant_email', tag: 'class.email_address' }, { column: 'claimant_phone', tag: 'pii' }], masked: ['claimant_email'], hints: ['postcode'] } },
      'main.claims.features': { name: 'main.claims.features', owner: 'ml-platform@northwind.example', comment: 'Model features', type: 'MANAGED', columns: 40, upstream: ['main.claims.fnol'], downstream: [], lineageSource: 'system.access.table_lineage', monitor: null,
        personal: { tagsRead: true, tagged: [], masked: [], hints: [] } },
    };
    await p.goto(URL); await W(800); await signIn(p, EMAIL['client:northwind']);

    // 1. connect: the AI card shows how the version in use was made, and what changed against the one before
    await p.goto(URL + '#card--' + ID); await W(1000);
    await p.getByRole('button', { name: /Connect a model registry/ }).click(); await W();
    await p.getByLabel('Workspace or server address').fill('https://adb-1.azuredatabricks.net');
    await p.getByLabel('Registered model name').fill('main.claims.triage');
    await p.getByLabel('Read-only access token').fill('dapi-test-token');
    await p.getByRole('button', { name: /Test and connect/ }).click(); await W(1500);
    let t = await body();
    assert(/How version 3 was made, from its training run/.test(t), 'training run panel');
    assert(t.includes('/Repos/claims/train_triage') && t.includes('1a2b3c4d5e6f') && t.includes('sklearn'), 'code and library shown');
    assert(t.includes('max_depth=6') && t.includes('main.claims.fnol') && t.includes('main.claims.features'), 'parameters and training tables shown');
    assert(/1 other input not from the catalog/.test(t), 'inputs that are not tables are counted');
    assert(/Version 3 compared with version 2/.test(t) && /f1 0\.75 to 0\.71 \(lower\)/.test(t) && /max_depth 4 to 6/.test(t) && /different data version/.test(t), 'comparison with the previous version');
    assert(row(ID).data.connector.versions[0].run.code.commit === '1a2b3c4d5e6f7a8b', 'run details stored with the connection');

    // 2. lifecycle: evidence can be attached from Databricks, marked with its read date
    await p.goto(URL + '#product--' + ID); await W(800);
    await p.getByRole('tab', { name: 'Lifecycle' }).click(); await W(500);
    const before = (await body()).match(/(\d+) of (\d+)\s+items done/);
    assert(await evRow().getByRole('button', { name: 'Attach from Databricks' }).count() === 1, 'offer on the item the registry can show');
    assert(await p.locator('.ev-row', { hasText: 'Human oversight plan' }).getByRole('button', { name: /from Databricks/ }).count() === 0, 'no offer where the registry shows nothing');
    await evRow().getByRole('button', { name: 'Attach from Databricks' }).click(); await W(600);
    t = await evRow().innerText();
    assert(/Auto-verified from Databricks · read \d+ \w+ \d{4}/.test(t), 'marked auto-verified with the read date: ' + t);
    assert(t.includes('main.claims.triage') && t.includes('1a2b3c4d5e6f'), 'the statement names the model and the code version');
    let ev = row(ID).data.stages[4].evidence[ITEM];
    assert(ev.auto && ev.auto.source === 'Databricks' && ev.auto.at === row(ID).data.connector.lastSync && ev.auto.version === '3', 'stored with source, read date and version');
    assert(db.tables.v2_audit.some((a) => a.action === 'Evidence attached from Databricks' && a.target === ID), 'in the audit log');
    const after = (await body()).match(/(\d+) of (\d+)\s+items done/);
    assert(before && after && +after[1] === +before[1] + 1, 'it counts towards the stage');
    assert(await evRow().getByRole('button', { name: 'Attach', exact: true }).count() === 0, 'no manual edit of an automatic statement');
    assert(await evRow().getByRole('button', { name: /Remove evidence/ }).count() === 1, 'it can be removed');

    // 3. data tab: the tables the model was trained on are offered for import; personal-data tags come with them
    await p.getByRole('tab', { name: /Data/ }).click(); await W(600);
    t = await body();
    assert(/What Databricks shows differs from what was declared/.test(t) && /trained on 2 tables not registered under Data and lineage/.test(t), 'undeclared training tables flagged');
    assert(/Model version 3 was trained on 2 tables not registered here/.test(t), 'import offer');
    await p.getByRole('button', { name: /Add them to the list/ }).click(); await W();
    await p.getByRole('button', { name: /Import tables/ }).click(); await W(1200);
    t = await body();
    const fnol = row(ID).data.datasets.find((d) => d.uc?.name === 'main.claims.fnol');
    const feat = row(ID).data.datasets.find((d) => d.uc?.name === 'main.claims.features');
    assert(fnol && fnol.personal === true && fnol.personalFrom === 'Unity Catalog tags', 'tagged table marked as personal data');
    assert(feat && feat.personal === false, 'untagged table left as it was');
    assert(/2 columns tagged personal or sensitive/.test(t) && t.includes('claimant_email (class.email_address)'), 'tagged columns listed');
    assert(/masked: claimant_email/.test(t) && /not masked: claimant_phone/.test(t), 'masked and unmasked columns told apart');
    assert(/worth a look: postcode/.test(t), 'name hints shown as hints');
    assert(/No column is tagged personal or sensitive/.test(t), 'a table with tags read and none found says so');
    assert(!/What Databricks shows differs from what was declared/.test(t), 'the flag clears once the tables are registered');

    // 4. forty-five days later: the read is out of date and no longer counts
    const old = new Date(Date.now() - 45 * 86400000).toISOString();
    const r = row(ID);
    r.data = { ...r.data, connector: { ...r.data.connector, lastSync: old }, stages: { ...r.data.stages, 4: { ...r.data.stages[4], evidence: { ...r.data.stages[4].evidence, [ITEM]: { ...ev, auto: { ...ev.auto, at: old } } } } } };
    db.calls.length = 0;
    await ctx.route('**/api/connector', (route) => (JSON.parse(route.request().postData() || '{}').action === 'sync' ? route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'offline' }) }) : route.fallback()));
    await p.reload(); await W(1200);
    await p.getByRole('tab', { name: 'Lifecycle' }).click(); await W(500);
    t = await evRow().innerText();
    assert(/Out of date · read/.test(t) && !/Auto-verified/.test(t), 'shown as out of date: ' + t);
    assert(/Check now/.test(t), 'tells the client how to refresh it');
    const stale = (await body()).match(/(\d+) of (\d+)\s+items done/);
    assert(+stale[1] === +before[1], 'no longer counted');
    await p.goto(URL + '#card--' + ID); await W(1000);
    assert(/Out of date/.test(await body()) && /last read more than 30 days ago/.test(await body()), 'the AI card says the read is old');

    // 5. checking the registry again makes it current; the evidence is refreshed with one click
    await ctx.unroute('**/api/connector'); await install(ctx, db);
    await p.reload(); await W(800);
    await p.getByRole('button', { name: /Check now/ }).click(); await W(1500);
    assert(new Date(row(ID).data.connector.lastSync).getTime() > Date.now() - 60000, 'read again');
    await p.goto(URL + '#product--' + ID); await W(800);
    await p.getByRole('tab', { name: 'Lifecycle' }).click(); await W(500);
    await evRow().getByRole('button', { name: 'Refresh from Databricks' }).click(); await W(600);
    t = await evRow().innerText();
    assert(/Auto-verified from Databricks · read/.test(t), 'current again');
    ev = row(ID).data.stages[4].evidence[ITEM];
    assert(ev.auto.at === row(ID).data.connector.lastSync, 'the new read date is stored');

    // 6. the reviewer sees what was attached automatically, and cannot attach
    await signOut(p); await signIn(p, EMAIL.assessor);
    await p.goto(URL + '#product--' + ID); await W(800);
    await p.getByRole('tab', { name: 'Lifecycle' }).click(); await W(500);
    t = await evRow().innerText();
    assert(/Auto-verified from Databricks/.test(t), 'reviewer sees the mark');
    assert(await p.getByRole('button', { name: /from Databricks/ }).count() === 0, 'reviewer cannot attach');

    // 7. the administrator can change how long a read stays current
    await signOut(p); await signIn(p, EMAIL.admin);
    await p.goto(URL + '#settings'); await W(800);
    const days = p.getByLabel('Days a registry read stays current');
    assert(await days.count() === 1, 'setting on the settings page');
    await days.fill('7'); await days.blur(); await W(600);
    assert(db.tables.v2_settings.some((x) => JSON.stringify(x).includes('"autoEvidenceDays":7')), 'the limit is saved');

    assert(!JSON.stringify(db.tables.v2_products).includes('dapi-test-token'), 'raw token never stored');
    assert(errs.length === 0, 'no page errors: ' + errs.join(' | '));
    console.log('DATABRICKS OK');
  } catch (e) {
    console.error(e.message); await p.screenshot({ path: 'e2e-shots/databricks-fail.png', fullPage: true }).catch(() => {}); process.exitCode = 1;
  } finally { await b.close(); }
})();
