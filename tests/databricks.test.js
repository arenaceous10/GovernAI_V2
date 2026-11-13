// What GovernAI reads from Databricks about a model (training run, training tables, personal-data tags) and how
// that becomes evidence: marked as auto-verified with the date it was read, and no longer counted once it is old.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readRegistry, readTables } from '../src/lib/server/connector.js';
import { STAGES } from '../src/data/lifecycle.js';
import {
  trainingTables, autoEvidence, evidenceCurrent, pullState, registryChecks, databricksFlags, versionDiff,
  AUTO_MAX_AGE_DAYS, autoMaxAge,
} from '../src/engine/governance.js';

const resolve = async () => [{ address: '93.184.216.34' }];
const json = (j, status = 200) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(j) });
const HOST = 'https://adb-1.2.azuredatabricks.net';

// ---------- a fake Databricks workspace ----------
const RUN = {
  info: { run_id: 'run3', experiment_id: '77', start_time: 1762500000000, end_time: 1762500600000, status: 'FINISHED' },
  data: {
    metrics: [{ key: 'accuracy', value: 0.93 }, { key: 'f1', value: 0.71 }],
    params: [{ key: 'max_depth', value: '6' }, { key: 'n_estimators', value: '200' }, { key: 'api_key', value: 'sk-secret-123' }, { key: 'db_password', value: 'hunter2' }],
    tags: [
      { key: 'mlflow.user', value: 'ds@example.com' },
      { key: 'mlflow.source.git.commit', value: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b' },
      { key: 'mlflow.source.git.repoURL', value: 'https://someone:ghp_tokenvalue@github.com/acme/risk.git' },
      { key: 'mlflow.databricks.notebookPath', value: '/Users/ds@example.com/train_risk' },
      { key: 'mlflow.log-model.history', value: JSON.stringify([{ flavors: { python_function: {}, sklearn: { sklearn_version: '1.5.0' } } }]) },
    ],
  },
  inputs: { dataset_inputs: [
    { tags: [{ key: 'mlflow.data.context', value: 'training' }], dataset: { name: 'main.claims.applicants@v12', digest: 'ab12cd', source_type: 'delta_table', source: JSON.stringify({ delta_table_name: 'main.claims.applicants', delta_table_version: 12 }) } },
    { tags: [{ key: 'mlflow.data.context', value: 'evaluation' }], dataset: { name: 'holdout', digest: 'ff00', source_type: 'databricks-uc-table', source: JSON.stringify({ table_name: 'main.claims.holdout' }) } },
    { tags: [], dataset: { name: 'local-frame', digest: '99', source_type: 'code', source: 'not json' } },
  ] },
};
const ucFetch = async (url) => {
  const u = new URL(url);
  if (/\/models\/main\.claims\.triage\/versions$/.test(u.pathname)) return json({ model_versions: [
    { version: 3, created_at: 1762500700000, status: 'READY', run_id: 'run3', comment: 'Third', source: 'dbfs:/x' },
    { version: 2, created_at: 1760000000000, status: 'READY', run_id: 'run2' },
  ] });
  if (/\/models\/main\.claims\.triage\/versions\/3$/.test(u.pathname)) return json({ version: 3, model_version_dependencies: { dependencies: [
    { table: { table_full_name: 'main.claims.features' } }, { function: { function_full_name: 'main.claims.bucket_age' } }, { table: { table_full_name: 'bad name; drop' } }, null,
  ] } });
  if (/\/models\/main\.claims\.triage$/.test(u.pathname)) return json({ comment: 'Scores claims for manual triage', owner: 'risk-team', created_by: 'ds@example.com', aliases: [{ alias_name: 'champion', version_num: 3 }] });
  if (/runs\/get/.test(u.pathname)) return u.searchParams.get('run_id') === 'run3' ? json({ run: RUN })
    : json({ run: { info: { run_id: 'run2', start_time: 1760000000000 }, data: { metrics: [{ key: 'accuracy', value: 0.9 }], params: [{ key: 'max_depth', value: '4' }, { key: 'n_estimators', value: '200' }] }, inputs: { dataset_inputs: [{ dataset: { name: 'main.claims.applicants@v9', digest: 'old1', source_type: 'delta_table', source: JSON.stringify({ delta_table_name: 'main.claims.applicants' }) } }] } } });
  return json({}, 404);
};

test('the training run is read with the model: code version, parameters, library and the datasets it used', async () => {
  const r = await readRegistry({ kind: 'databricks-uc', host: HOST, model: 'main.claims.triage', token: 't' }, { fetchImpl: ucFetch, resolve });
  const v = r.versions[0];
  assert.equal(v.version, '3');
  assert.deepEqual(v.metrics, { accuracy: 0.93, f1: 0.71 });
  assert.equal(v.run.startedAt, new Date(1762500000000).toISOString());
  assert.equal(v.run.user, 'ds@example.com');
  assert.equal(v.run.code.commit, '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b');
  assert.equal(v.run.code.source, '/Users/ds@example.com/train_risk');
  assert.deepEqual(v.run.flavors, ['sklearn']);
  assert.deepEqual(v.run.params, { max_depth: '6', n_estimators: '200' }, 'parameters that look like secrets are never read');
  assert.deepEqual(v.run.datasets.map((d) => [d.name, d.table, d.context, d.digest]), [
    ['main.claims.applicants@v12', 'main.claims.applicants', 'training', 'ab12cd'],
    ['holdout', 'main.claims.holdout', 'evaluation', 'ff00'],
    ['local-frame', null, '', '99'],
  ]);
  assert.equal(r.versions[1].run.params.max_depth, '4');
});

test('a token inside a repository address is never kept', async () => {
  const r = await readRegistry({ kind: 'databricks-uc', host: HOST, model: 'main.claims.triage', token: 't' }, { fetchImpl: ucFetch, resolve });
  const text = JSON.stringify(r);
  assert.ok(!/ghp_tokenvalue|someone:|sk-secret|hunter2/.test(text), 'no credential reaches the stored result');
  assert.equal(r.versions[0].run.code.repo, 'https://github.com/acme/risk.git');
});

test('Unity Catalog model dependencies are read for the version in use (the champion, else the newest)', async () => {
  const r = await readRegistry({ kind: 'databricks-uc', host: HOST, model: 'main.claims.triage', token: 't' }, { fetchImpl: ucFetch, resolve });
  assert.deepEqual(r.versions[0].dependencies, { tables: ['main.claims.features'], functions: ['main.claims.bucket_age'] });
  assert.equal(r.versions[1].dependencies, undefined);
});

test('a registry that returns nothing about the run still reads: the run details are simply absent', async () => {
  const bare = async (url) => (/versions$/.test(new URL(url).pathname) ? json({ model_versions: [{ version: 1, run_id: 'r1' }] }) : /runs\/get/.test(url) ? json({ run: { data: {} } }) : json({}, 404));
  const r = await readRegistry({ kind: 'databricks-uc', host: HOST, model: 'main.claims.triage', token: 't' }, { fetchImpl: bare, resolve });
  assert.deepEqual(r.versions[0].metrics, {});
  assert.deepEqual(r.versions[0].run.datasets, []);
  assert.deepEqual(r.versions[0].run.params, {});
  assert.equal(r.versions[0].dependencies, undefined);
});

test('MLflow registries give the run details too, and the model tags', async () => {
  const f = async (url) => {
    const u = new URL(url);
    if (/model-versions\/search/.test(u.pathname)) return json({ model_versions: [{ version: '5', run_id: 'run3', current_stage: 'Production', creation_timestamp: 1762500700000 }] });
    if (/registered-models\/get/.test(u.pathname)) return json({ registered_model: { description: 'Triage', tags: [{ key: 'team', value: 'risk' }, { key: 'x'.repeat(300), value: 'y'.repeat(900) }] } });
    if (/runs\/get/.test(u.pathname)) return json({ run: RUN });
    return json({}, 404);
  };
  const r = await readRegistry({ kind: 'mlflow', host: 'https://mlflow.example.com', model: 'triage', token: 't' }, { fetchImpl: f, resolve });
  assert.equal(r.versions[0].run.code.commit.length, 40);
  assert.equal(r.info.tags.team, 'risk');
  assert.ok(Object.keys(r.info.tags).every((k) => k.length <= 60) && Object.values(r.info.tags).every((v) => v.length <= 120));
});

// ---------- personal-data tags ----------
const tableFetch = (opts = {}) => async (url, init) => {
  const u = new URL(url);
  if (/unity-catalog\/tables\/main\.claims\.applicants$/.test(u.pathname)) return json({ table_id: 't1', owner: 'data-team', comment: 'Applicants', table_type: 'MANAGED', columns: [
    { name: 'applicant_id' }, { name: 'email', mask: { function_name: 'main.claims.mask_email' } }, { name: 'phone_number' }, { name: 'age' }, { name: 'date_of_birth' }, { name: 'postcode' }, { name: 'notes' },
  ] });
  if (/statements/.test(u.pathname)) {
    const st = JSON.parse(init.body).statement;
    if (/column_tags/.test(st)) {
      if (opts.tagsFail) return json({ status: { state: 'FAILED', error: { message: 'no access' } } });
      const cols = ['catalog_name', 'schema_name', 'table_name', 'column_name', 'tag_name', 'tag_value'];
      const rows = [
        ['main', 'claims', 'applicants', 'email', 'class.email_address', ''],
        ['main', 'claims', 'applicants', 'phone_number', 'pii', 'true'],
        ['main', 'claims', 'applicants', 'age', 'pii', 'false'],
        ['main', 'claims', 'applicants', 'notes', 'sensitivity', 'restricted'],
        ['main', 'claims', 'applicants', 'applicant_id', 'cost_center', 'hr'],
        ['main', 'claims', 'other', 'ssn', 'pii', 'true'],
      ];
      return json({ status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: cols.map((name) => ({ name })) } }, result: { data_array: rows } });
    }
    return json({ status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: ['source_table_full_name', 'target_table_full_name', 'last_seen'].map((name) => ({ name })) } }, result: { data_array: [['main.raw.crm', 'main.claims.applicants', 'x']] } });
  }
  return json({}, 404);
};

test('columns tagged as personal data in Unity Catalog are read with the table', async () => {
  const r = await readTables({ base: HOST, token: 't', tables: ['main.claims.applicants'], warehouseId: '2bce45dbd06434d1' }, { fetchImpl: tableFetch() });
  const p = r.tables[0].personal;
  assert.equal(p.tagsRead, true);
  assert.deepEqual(p.tagged.map((x) => `${x.column}:${x.tag}`), ['email:class.email_address', 'notes:sensitivity=restricted', 'phone_number:pii']);
  assert.ok(!p.tagged.some((x) => x.column === 'age'), 'a tag that says "not personal" is not counted');
  assert.ok(!p.tagged.some((x) => x.column === 'applicant_id'), 'an unrelated tag is not counted');
  assert.deepEqual(p.masked, ['email']);
  assert.deepEqual(p.hints, ['date_of_birth', 'postcode'], 'untagged columns whose names suggest personal data are listed as hints only');
  assert.deepEqual(r.tables[0].upstream, ['main.raw.crm'], 'lineage still comes with it');
});

test('without a SQL warehouse, or when tags cannot be read, GovernAI says so instead of reporting "no personal data"', async () => {
  const noWh = await readTables({ base: HOST, token: 't', tables: ['main.claims.applicants'], warehouseId: '' }, { fetchImpl: tableFetch() });
  assert.equal(noWh.tables[0].personal.tagsRead, false);
  assert.deepEqual(noWh.tables[0].personal.tagged, []);
  assert.deepEqual(noWh.tables[0].personal.masked, ['email']);
  const failed = await readTables({ base: HOST, token: 't', tables: ['main.claims.applicants'], warehouseId: '2bce45dbd06434d1' }, { fetchImpl: tableFetch({ tagsFail: true }) });
  assert.equal(failed.tables[0].personal.tagsRead, false);
  assert.ok(failed.notes.some((n) => /tags/i.test(n)));
  assert.deepEqual(failed.tables[0].upstream, ['main.raw.crm']);
});

// ---------- what the stored connection says ----------
const DAY = 86400000;
const NOW = new Date('2026-11-13T10:00:00Z');
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();
const connector = (o = {}) => ({
  kind: 'databricks-uc', host: HOST, model: 'main.claims.triage', latest: '3', lastSync: ago(1),
  info: { description: 'Scores claims for manual triage', owner: 'risk-team', createdBy: 'ds@example.com' },
  versions: [
    { version: '3', createdAt: ago(5), aliases: ['champion'], runId: 'run3', metrics: { accuracy: 0.93, f1: 0.71 },
      run: { startedAt: ago(6), user: 'ds@example.com', code: { commit: '1a2b3c4d5e6f', source: '/Users/ds/train' }, flavors: ['sklearn'], params: { max_depth: '6', n_estimators: '200' },
        datasets: [{ name: 'main.claims.applicants@v12', table: 'main.claims.applicants', digest: 'ab12cd', context: 'training' }, { name: 'holdout', table: 'main.claims.holdout', digest: 'ff00', context: 'evaluation' }, { name: 'local', table: null, digest: '1', context: '' }] },
      dependencies: { tables: ['main.claims.features', 'main.claims.applicants'], functions: [] } },
    { version: '2', createdAt: ago(40), aliases: [], runId: 'run2', metrics: { accuracy: 0.9, f1: 0.75 },
      run: { startedAt: ago(41), code: { commit: '000111' }, flavors: ['sklearn'], params: { max_depth: '4', n_estimators: '200' }, datasets: [{ name: 'main.claims.applicants@v9', table: 'main.claims.applicants', digest: 'old1', context: 'training' }] } },
  ],
  monitoring: { table: 'main.claims.inference', monitor: { status: 'ACTIVE' }, drift: { windowEnd: ago(1), checked: 9, drifted: [] },
    performance: { windowEnd: ago(1), rows: 4000, metrics: { recall_positive: 0.8 }, slices: [{ key: 'sex', value: 'F', rows: 2000, metrics: { recall_positive: 0.78 } }, { key: 'sex', value: 'M', rows: 2000, metrics: { recall_positive: 0.82 } }] } },
  genai: { evaluations: [] },
  ...o,
});
const uc = (name, o = {}) => ({ id: `ds-${name}`, name, role: 'Training', personal: false, uc: { name, upstream: ['main.raw.crm'], downstream: [], lineageSource: 'system.access.table_lineage', readAt: ago(1), personal: { tagsRead: true, tagged: [], masked: [], hints: [] }, ...o } });

test('the tables that fed the model come from the run\'s datasets and the model\'s own dependencies, each once', () => {
  const t = trainingTables(connector());
  assert.deepEqual(t.tables.map((x) => x.name), ['main.claims.applicants', 'main.claims.features', 'main.claims.holdout']);
  assert.equal(t.version, '3');
  assert.equal(t.tables[0].digest, 'ab12cd');
  assert.deepEqual(t.tables[0].via, ['run', 'model']);
  assert.equal(t.other, 1, 'inputs that are not catalog tables are counted, not listed as tables');
  assert.deepEqual(trainingTables(null), { version: null, tables: [], other: 0 });
  assert.deepEqual(trainingTables({ versions: [{ version: '1' }] }).tables, []);
});

test('how old a read is decides whether it still counts', () => {
  assert.equal(AUTO_MAX_AGE_DAYS, 30);
  assert.equal(pullState(ago(1), { now: NOW }).expired, false);
  assert.equal(pullState(ago(30), { now: NOW }).expired, false, 'the last day still counts');
  assert.equal(pullState(ago(31), { now: NOW }).expired, true);
  assert.equal(pullState(ago(8), { now: NOW, maxAgeDays: 7 }).expired, true, 'the administrator can shorten it');
  assert.equal(pullState(null, { now: NOW }).expired, true, 'no date is never current');
  assert.equal(pullState('rubbish', { now: NOW }).expired, true);
  assert.equal(pullState(new Date(NOW.getTime() + DAY).toISOString(), { now: NOW }).expired, false, 'a clock a little ahead does not expire it');
  assert.equal(autoMaxAge({}), 30);
  assert.equal(autoMaxAge({ autoEvidenceDays: 14 }), 14);
  for (const bad of [0, -3, 'x', null, 99999]) assert.equal(autoMaxAge({ autoEvidenceDays: bad }), bad === 99999 ? 365 : 30);
});

test('evidence GovernAI can attach from Databricks names the facts and the day they were read', () => {
  const x = { stage: 5, connector: connector(), datasets: [uc('main.claims.applicants')] };
  const ev = autoEvidence(x, { now: NOW });
  for (const k of Object.keys(ev)) assert.ok(STAGES.some((s) => s.evidence.includes(k)), `${k} is a real evidence item`);
  const cfg = ev['Configuration and version records'];
  assert.match(cfg.text, /main\.claims\.triage/); assert.match(cfg.text, /version 3/i); assert.match(cfg.text, /1a2b3c4d5e6f/); assert.match(cfg.text, /max_depth=6/);
  assert.equal(cfg.at, ago(1)); assert.equal(cfg.expired, false); assert.equal(cfg.source, 'Databricks');
  assert.match(ev['Evaluation and validation report'].text, /accuracy 0\.93/);
  assert.match(ev['Fairness and subgroup assessment'].text, /sex/);
  assert.match(ev['Monitoring dashboard and reports'].text, /active/i);
  assert.match(ev['Dataset lineage, version and access record'].text, /main\.claims\.applicants/);
  assert.match(ev['Dataset lineage, version and access record'].text, /ab12cd/);
  assert.match(ev['Regression results'].text, /accuracy 0\.9 to 0\.93/);
  assert.match(ev['Regression results'].text, /f1 0\.75 to 0\.71 \(lower\)/, 'a metric that got worse is called out');
});

test('nothing is offered that Databricks did not actually show', () => {
  assert.deepEqual(autoEvidence({ stage: 5 }, { now: NOW }), {});
  const thin = autoEvidence({ stage: 5, connector: { kind: 'databricks-uc', model: 'a.b.c', lastSync: ago(1), latest: '1', versions: [{ version: '1' }] } }, { now: NOW });
  assert.deepEqual(Object.keys(thin), ['Configuration and version records']);
  const noSync = autoEvidence({ stage: 5, connector: { ...connector(), lastSync: null } }, { now: NOW });
  assert.deepEqual(noSync, {}, 'a connection that was never read offers nothing');
  const inactive = autoEvidence({ stage: 7, connector: connector({ monitoring: { table: 't', monitor: { status: 'FAILED' } } }) }, { now: NOW });
  assert.equal(inactive['Monitoring dashboard and reports'], undefined);
  assert.equal(inactive['Fairness and subgroup assessment'], undefined);
});

test('a read older than the limit is offered as expired, not as proof', () => {
  const old = autoEvidence({ stage: 5, connector: connector({ lastSync: ago(45) }) }, { now: NOW });
  assert.equal(old['Configuration and version records'].expired, true);
  const short = autoEvidence({ stage: 5, connector: connector({ lastSync: ago(10) }) }, { now: NOW, maxAgeDays: 7 });
  assert.equal(short['Configuration and version records'].expired, true);
});

test('attached evidence: a person\'s upload never expires; an automatic one stops counting when it is old', () => {
  assert.equal(evidenceCurrent(null), false);
  assert.equal(evidenceCurrent({ ref: 'https://x.example/doc', at: ago(400) }, { now: NOW }), true);
  assert.equal(evidenceCurrent({ file: 'a.pdf', at: ago(400) }, { now: NOW }), true);
  const auto = (d) => ({ ref: 'Databricks: ...', auto: { source: 'Databricks', at: ago(d) } });
  assert.equal(evidenceCurrent(auto(2), { now: NOW }), true);
  assert.equal(evidenceCurrent(auto(31), { now: NOW }), false);
  assert.equal(evidenceCurrent(auto(10), { now: NOW, maxAgeDays: 7 }), false);
  assert.equal(evidenceCurrent({ ref: '', file: '', auto: { at: ago(1) } }, { now: NOW }), false, 'an empty value is not evidence');
  // An approved stage is judged on the day it was approved: what was current then stays part of the record.
  assert.equal(evidenceCurrent(auto(90), { now: NOW, asOf: ago(80) }), true);
  assert.equal(evidenceCurrent(auto(90), { now: NOW, asOf: ago(20) }), false);
});

test('checks the registry confirms carry the read date, and stop confirming when the read is old', () => {
  const x = { card: { modelVersion: '3' }, connector: connector() };
  const c = registryChecks(x, { now: NOW });
  const live = c['Monitoring dashboards and alerts are live.'];
  assert.equal(live.ok, true); assert.equal(live.at, ago(1)); assert.equal(live.expired, false); assert.equal(live.source, 'Databricks');
  const groups = c['Results are analyzed by relevant groups and worst-performing segments.'];
  assert.equal(groups.ok, true); assert.match(groups.note, /sex/);
  const old = registryChecks({ card: { modelVersion: '3' }, connector: connector({ lastSync: ago(60) }) }, { now: NOW });
  assert.equal(old['Monitoring dashboards and alerts are live.'].expired, true);
  assert.equal(old['Monitoring dashboards and alerts are live.'].ok, true, 'what it said is kept; the screen shows it as out of date');
  const none = registryChecks({ connector: connector({ monitoring: { monitor: { status: 'ACTIVE' }, performance: { metrics: {} } } }) }, { now: NOW });
  assert.equal(none['Results are analyzed by relevant groups and worst-performing segments.'], undefined, 'no by-group figures is not held against the client');
  assert.equal(registryChecks({ connector: { kind: 'mlflow', lastSync: ago(1), versions: [] } }, { now: NOW })['Previous configuration is recoverable.'].source, 'the registry');
  for (const k of Object.keys(c)) assert.ok(STAGES.some((s) => s.checklist.includes(k)), `${k} is a real checklist item`);
});

test('what Databricks shows is compared with what was declared, for the reviewer', () => {
  const profile = (data) => ({ data, answers: {} });
  const tagged = uc('main.claims.applicants', { personal: { tagsRead: true, tagged: [{ column: 'email', tag: 'class.email_address' }, { column: 'phone', tag: 'pii' }], masked: ['email'], hints: [] } });
  const ids = (x) => databricksFlags(x).map((f) => f.id);
  // 1. the profile says no personal data, the catalog tags personal columns
  const a = databricksFlags({ assessment: { profile: profile(['none']), questions: [], answers: {} }, datasets: [{ ...tagged, personal: true }], connector: connector({ versions: [] }) });
  assert.deepEqual(a.map((f) => f.id), ['personal-profile']);
  assert.match(a[0].text, /email/);
  assert.deepEqual(ids({ assessment: { profile: profile(['contact']), questions: [], answers: {} }, datasets: [{ ...tagged, personal: true }], connector: connector({ versions: [] }) }), []);
  // 2. the dataset is marked "no personal data" although its columns are tagged
  assert.deepEqual(ids({ assessment: { profile: profile(['contact']), questions: [], answers: {} }, datasets: [tagged], connector: connector({ versions: [] }) }), ['personal-dataset']);
  // 3. the training run read tables that are not registered as datasets
  const und = databricksFlags({ assessment: { profile: profile(['contact']), questions: [], answers: {} }, datasets: [uc('main.claims.applicants')], connector: connector() });
  assert.deepEqual(und.map((f) => f.id), ['undeclared']);
  assert.match(und[0].text, /main\.claims\.features/); assert.match(und[0].text, /main\.claims\.holdout/);
  assert.ok(!/main\.claims\.applicants/.test(und[0].text));
  // 4. lineage is answered as documented, but the catalog shows none for the imported tables
  const q = [{ id: 'DG-C2' }];
  const noLin = uc('main.claims.applicants', { upstream: [], downstream: [] });
  const base = { assessment: { profile: profile(['contact']), questions: q, answers: { 'DG-C2': 3 } }, connector: connector({ versions: [] }) };
  assert.deepEqual(ids({ ...base, datasets: [noLin] }), ['lineage']);
  assert.deepEqual(ids({ ...base, datasets: [uc('main.claims.applicants')] }), []);
  assert.deepEqual(ids({ ...base, assessment: { ...base.assessment, answers: { 'DG-C2': 1 } }, datasets: [noLin] }), [], 'an honest "not written down" is not flagged');
  assert.deepEqual(ids({ ...base, datasets: [uc('main.claims.applicants', { upstream: [], downstream: [], lineageSource: null })] }), [], 'lineage that could not be read proves nothing');
  // nothing connected, nothing to compare
  assert.deepEqual(databricksFlags({ assessment: { profile: profile(['none']) }, datasets: [] }), []);
  assert.deepEqual(databricksFlags(null), []);
});

test('a card version written as "3 (champion)" still matches registry version 3', () => {
  const ok = registryChecks({ card: { modelVersion: '3 (champion)' }, connector: connector() }, { now: NOW });
  assert.equal(ok['Approval status and production version are updated in the inventory.'].ok, true);
  const no = registryChecks({ card: { modelVersion: '30 (champion)' }, connector: connector() }, { now: NOW });
  assert.equal(no['Approval status and production version are updated in the inventory.'].ok, false);
});

test('two versions are compared on what changed: metrics, parameters, training data and code', () => {
  const d = versionDiff(connector(), '2', '3');
  assert.deepEqual(d.metrics.map((m) => [m.name, m.from, m.to, m.worse]), [['accuracy', 0.9, 0.93, false], ['f1', 0.75, 0.71, true]]);
  assert.deepEqual(d.params, [{ name: 'max_depth', from: '4', to: '6' }]);
  assert.deepEqual(d.data, [{ table: 'main.claims.applicants', from: 'old1', to: 'ab12cd' }, { table: 'main.claims.holdout', from: null, to: 'ff00' }]);
  assert.equal(d.code.changed, true);
  assert.equal(versionDiff(connector(), '1', '3'), null, 'a version GovernAI has no details for cannot be compared');
  assert.equal(versionDiff(null, '2', '3'), null);
});

test('the Annex IV draft states how the model was made and what it was trained on, with the read date', async () => {
  const { annexIV } = await import('../src/engine/docpack.js');
  const { buildSeed } = await import('../src/store/seed.js');
  const base = buildSeed().systems.find((x) => x.assessment && x.stage >= 4);
  const s = { ...base, connector: connector(), datasets: [{ ...uc('main.claims.applicants', { personal: { tagsRead: true, tagged: [{ column: 'email', tag: 'pii' }], masked: [], hints: [] } }), personal: true, classification: 'Confidential', sourceSystem: 'Databricks Unity Catalog' }] };
  const text = JSON.stringify(annexIV(s, { client: { name: 'Acme' } }));
  assert.match(text, /Training run of version 3/);
  assert.match(text, /commit 1a2b3c4d5e6f/);
  assert.match(text, /max_depth=6/);
  assert.match(text, /trained on \(from the registry, read/);
  assert.match(text, /main\.claims\.features/);
  assert.match(text, /columns tagged personal or sensitive in Unity Catalog: email/);
  const plain = JSON.stringify(annexIV(base, { client: { name: 'Acme' } }));
  assert.ok(!/Training run of version/.test(plain), 'nothing is invented for a product with no registry');
});

test('the stage completion figure leaves out automatic evidence that has gone out of date', async () => {
  const { stageCompletion, stagePct } = await import('../src/data/controls.js');
  const st = STAGES[3];   // stage 4
  const fresh = new Date(Date.now() - 2 * DAY).toISOString(); const old = new Date(Date.now() - 45 * DAY).toISOString();
  const rec = (at, extra = {}) => ({ status: 'open', checklist: {}, evidence: { 'Configuration and version records': { ref: 'Databricks: x', auto: { source: 'Databricks', at } }, 'Human oversight plan': { ref: 'https://example.com/plan' } }, ...extra });
  assert.equal(stageCompletion(st, rec(fresh), 'limited', {}).evidence.done, 2);
  assert.equal(stageCompletion(st, rec(old), 'limited', {}).evidence.done, 1, 'only the link a person attached still counts');
  assert.equal(stageCompletion(st, rec(fresh), 'limited', {}, 1).evidence.done, 1, 'the administrator\'s shorter limit applies');
  assert.equal(stageCompletion(st, rec(old, { status: 'approved', approvedAt: new Date(Date.now() - 40 * DAY).toISOString() }), 'limited', {}).evidence.done, 2, 'an approved stage keeps what was current when it was approved');
  assert.equal(stagePct(st, rec(old), 'limited', {}), stageCompletion(st, rec(old), 'limited', {}).pct);
});

test('the reviewer is told when an automatic statement no longer matches what the registry shows', async () => {
  const { autoMismatch } = await import('../src/engine/governance.js');
  const x = { stage: 4, connector: connector() };
  const fact = autoEvidence(x, { now: NOW })['Configuration and version records'];
  const ev = (ref, at = fact.at) => ({ 'Configuration and version records': { ref, file: '', auto: { source: 'Databricks', at, version: '3' } }, 'Human oversight plan': { ref: 'https://example.com/plan' } });
  assert.deepEqual(autoMismatch(x, { evidence: ev(fact.text) }), [], 'the stored statement is what the registry shows');
  // the same facts read on a later day still match: only the facts are compared, not the date
  const later = { stage: 4, connector: connector({ lastSync: NOW.toISOString() }) };
  assert.deepEqual(autoMismatch(later, { evidence: ev(fact.text) }), []);
  // edited text, or a registry that has moved on
  const forged = autoMismatch(x, { evidence: ev(fact.text.replace('max_depth=6', 'max_depth=2')) });
  assert.deepEqual(forged.map((m) => [m.item, m.reason]), [['Configuration and version records', 'differs']]);
  const moved = autoMismatch({ stage: 4, connector: connector({ versions: [{ version: '4', aliases: ['champion'] }, ...connector().versions.map((v) => ({ ...v, aliases: [] }))], latest: '4' }) }, { evidence: ev(fact.text) });
  assert.equal(moved[0].reason, 'differs');
  // the registry no longer shows anything for the item
  const gone = autoMismatch({ stage: 4, connector: { ...connector(), versions: [], latest: null } }, { evidence: ev(fact.text) });
  assert.deepEqual(gone.map((m) => m.reason), ['gone']);
  assert.deepEqual(autoMismatch(x, { evidence: { 'Human oversight plan': { ref: 'https://example.com/plan' } } }), [], 'evidence a person attached is not compared');
  assert.deepEqual(autoMismatch(x, null), []);
});
