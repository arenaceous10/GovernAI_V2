// Model-registry connector (server side): reads model versions and their run metrics from MLflow or from
// Databricks Unity Catalog, with the client's read-only token.
//
// Tokens are sealed with AES-256-GCM under CONNECTOR_KEY (server only) and bound to the product id, so the sealed
// value stored in the product is useless to anyone who reads it, and cannot be moved to another product.
// Outbound calls are limited: https only, public addresses only (checked after DNS), no redirects, 8 s timeout,
// 2 MB per response. CONNECTOR_ALLOW_LOCAL=1 (tests only) allows http://localhost.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const KINDS = { mlflow: 'MLflow model registry', 'databricks-uc': 'Databricks Unity Catalog' };

export function seal(token, productId, keyB64) {
  const key = Buffer.from(keyB64 || '', 'base64');
  if (key.length !== 32) throw new Error('Connector key is not configured');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(`governai:${productId}`));
  const ct = Buffer.concat([c.update(String(token), 'utf8'), c.final()]);
  return `v1.${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
}
export function unseal(sealed, productId, keyB64) {
  const key = Buffer.from(keyB64 || '', 'base64');
  if (key.length !== 32 || !/^v1\./.test(sealed || '')) throw new Error('No usable token');
  const raw = Buffer.from(sealed.slice(3), 'base64');
  const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12)); d.setAAD(Buffer.from(`governai:${productId}`));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

const PRIVATE = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^192\.0\.0\./, /^198\.1[89]\./, /^2(2[4-9]|3\d|[4-5]\d)\./, /^::1?$/, /^f[cd]/i, /^fe[89ab]/i, /^::ffff:(0|10|127|169\.254|172\.(1[6-9]|2\d|3[01])|192\.168)\./i,
];
const isPrivate = (ip) => PRIVATE.some((re) => re.test(ip));

// Returns a clean base URL, or throws with a message fit for the user.
export async function checkHost(input, { allowLocal = false, resolve = lookup } = {}) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { throw new Error('Enter the full address, starting with https://'); }
  const local = allowLocal && u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !local) throw new Error('Only https addresses are allowed');
  if (u.username || u.password) throw new Error('Put the token in the token field, not in the address');
  if (!local) {
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (/^(localhost|.*\.local|.*\.internal|metadata\..*)$/i.test(host)) throw new Error('That address is not reachable from GovernAI');
    const addrs = isIP(host) ? [{ address: host }] : await resolve(host, { all: true }).catch(() => []);
    if (!addrs.length) throw new Error('That address could not be found');
    if (addrs.some((a) => isPrivate(a.address))) throw new Error('That address is on a private network, which GovernAI cannot reach');
  }
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

async function getJson(fetchImpl, url, token, { body, timeout = 8000, notFound = 'The model was not found in the registry' } = {}) {
  const r = await fetchImpl(url, {
    method: body ? 'POST' : 'GET',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual', signal: AbortSignal.timeout(timeout),
  });
  if (r.status >= 300 && r.status < 400) throw new Error('The registry redirected the request, which is not followed');
  if (r.status === 401 || r.status === 403) throw new Error('The registry refused the token (check it is valid and can read this model)');
  if (r.status === 404) throw new Error(notFound);
  if (!r.ok) throw new Error(`The registry answered with an error (HTTP ${r.status})`);
  const text = await r.text();
  if (text.length > 2_000_000) throw new Error('The registry response was too large');
  try { return JSON.parse(text); } catch { throw new Error('The registry did not return JSON'); }
}

const num = (v) => (Number.isFinite(+v) ? +v : null);
const iso = (ms) => (num(ms) != null ? new Date(+ms).toISOString() : null);

// Reads up to 50 versions, newest first, with metrics for the newest 3. Returns { model, versions, latest }.
export async function readRegistry({ kind, host, model, token }, { fetchImpl = fetch, allowLocal = false, resolve } = {}) {
  if (!KINDS[kind]) throw new Error('Choose MLflow or Databricks Unity Catalog');
  const name = String(model || '').trim();
  if (!name || name.length > 200 || /[\s'"\\]/.test(name)) throw new Error('Enter the registered model name exactly as it appears in the registry');
  const checked = await checkHost(host, { allowLocal, resolve });
  // A Databricks workspace answers at its root, so a pasted page address (path, ?o=...) is trimmed to the origin.
  const base = kind === 'databricks-uc' ? new URL(checked).origin : checked;
  let versions; let info = {};
  if (kind === 'mlflow') {
    const [j, m] = await Promise.all([
      getJson(fetchImpl, `${base}/api/2.0/mlflow/model-versions/search?max_results=50&filter=${encodeURIComponent(`name='${name}'`)}`, token),
      getJson(fetchImpl, `${base}/api/2.0/mlflow/registered-models/get?name=${encodeURIComponent(name)}`, token).catch(() => ({})),
    ]);
    const rm = m.registered_model || {};
    info = { description: String(rm.description || '').slice(0, 1000), owner: '', createdBy: String(rm.user_id || '').slice(0, 200) };
    versions = (j.model_versions || []).map((v) => ({
      version: String(v.version), createdAt: iso(v.creation_timestamp), status: v.status || '', stage: v.current_stage || '',
      aliases: v.aliases || [], runId: v.run_id || '', description: String(v.description || '').slice(0, 500), source: String(v.source || '').slice(0, 300),
    }));
  } else {
    if (name.split('.').length !== 3) throw new Error('Unity Catalog models are named catalog.schema.model');
    const path = name.split('.').map(encodeURIComponent).join('.');
    const [j, m] = await Promise.all([
      getJson(fetchImpl, `${base}/api/2.1/unity-catalog/models/${path}/versions?max_results=50`, token),
      getJson(fetchImpl, `${base}/api/2.1/unity-catalog/models/${path}?include_aliases=true`, token).catch(() => ({})),
    ]);
    const al = {};
    for (const a of m.aliases || []) (al[String(a.version_num)] ||= []).push(a.alias_name);
    info = { description: String(m.comment || '').slice(0, 1000), owner: String(m.owner || '').slice(0, 200), createdBy: String(m.created_by || '').slice(0, 200) };
    versions = (j.model_versions || []).map((v) => ({
      version: String(v.version), createdAt: iso(v.created_at), status: v.status || '', stage: '',
      aliases: al[String(v.version)] || [], runId: v.run_id || '', description: String(v.comment || '').slice(0, 500), source: String(v.source || '').slice(0, 300),
    }));
  }
  versions.sort((a, b) => (+b.version || 0) - (+a.version || 0));
  for (const v of versions.slice(0, 3)) {
    if (!v.runId || !/^[A-Za-z0-9_-]{1,64}$/.test(v.runId)) continue;
    try {
      const r = await getJson(fetchImpl, `${base}/api/2.0/mlflow/runs/get?run_id=${encodeURIComponent(v.runId)}`, token);
      v.metrics = Object.fromEntries((r.run?.data?.metrics || []).slice(0, 30).map((x) => [String(x.key).slice(0, 60), num(x.value)]).filter(([, x]) => x != null));
      if (r.run?.info?.experiment_id) v.experimentId = String(r.run.info.experiment_id).slice(0, 40);
    } catch { v.metrics = {}; }
  }
  return { model: name, base, info, versions: versions.slice(0, 50), latest: versions[0]?.version || null };
}

// ---------- GenAI evaluations and traces (MLflow) ----------
// Evaluation runs are ordinary MLflow runs whose metrics are aggregates such as "correctness/mean" or
// "safety/pass_rate". Traces are read from the same experiment. Everything here is best effort: a part that cannot
// be read is reported as unavailable instead of failing the whole check.
const EVAL_METRIC = /(\/mean|\/pass_rate|_mean|_pass_rate|\/ratio)$/;
const ID = /^[0-9]{1,30}$/;

async function experimentId(fetchImpl, base, token, wanted, versions) {
  const w = String(wanted || '').trim();
  if (ID.test(w)) return w;
  if (w) {
    if (w.length > 300 || /[\n\r]/.test(w)) throw new Error('Enter the experiment ID, or its full path such as /Users/you@example.com/my_app');
    const j = await getJson(fetchImpl, `${base}/api/2.0/mlflow/experiments/get-by-name?experiment_name=${encodeURIComponent(w)}`, token, { notFound: `Experiment ${w} was not found` });
    return j.experiment?.experiment_id ? String(j.experiment.experiment_id) : null;
  }
  return versions.find((v) => v.experimentId)?.experimentId || null;
}

export async function readGenAI({ base, token, experiment, versions = [] }, { fetchImpl = fetch } = {}) {
  const out = { experimentId: null, evaluations: [], traces: null, notes: [] };
  try { out.experimentId = await experimentId(fetchImpl, base, token, experiment, versions); } catch (e) { out.notes.push(e.message); return out; }
  if (!out.experimentId) { out.notes.push('No experiment found: set one, or register a model version that came from a run'); return out; }
  const eid = out.experimentId;
  const [runs, traces] = await Promise.allSettled([
    getJson(fetchImpl, `${base}/api/2.0/mlflow/runs/search`, token, { body: { experiment_ids: [eid], max_results: 100, order_by: ['attributes.start_time DESC'] } }),
    (async () => {
      try {
        return await getJson(fetchImpl, `${base}/api/2.0/mlflow/traces?experiment_ids=${encodeURIComponent(eid)}&max_results=100&order_by=${encodeURIComponent('timestamp_ms DESC')}`, token);
      } catch {
        return getJson(fetchImpl, `${base}/api/3.0/mlflow/traces/search`, token, { body: { locations: [{ type: 'MLFLOW_EXPERIMENT', mlflow_experiment: { experiment_id: eid } }], max_results: 100, order_by: ['timestamp_ms DESC'] } });
      }
    })(),
  ]);
  if (runs.status === 'fulfilled') {
    out.evaluations = (runs.value.runs || []).map((r) => ({
      runId: String(r.info?.run_id || '').slice(0, 64), name: String(r.info?.run_name || '').slice(0, 120), at: iso(r.info?.start_time),
      metrics: Object.fromEntries((r.data?.metrics || []).filter((m) => EVAL_METRIC.test(m.key)).slice(0, 20).map((m) => [String(m.key).slice(0, 60), num(m.value)]).filter(([, v]) => v != null)),
    })).filter((r) => Object.keys(r.metrics).length).slice(0, 10);
  } else out.notes.push('Evaluation runs could not be read');
  if (traces.status === 'fulfilled') {
    const list = traces.value.traces || [];
    const info = (t) => t.trace_info || t.info || t;
    const at = (t) => num(info(t).timestamp_ms) ?? (info(t).request_time ? Date.parse(info(t).request_time) : null);
    const state = (t) => String(info(t).status || info(t).state || '').toUpperCase();
    const times = list.map(at).filter((x) => x != null);
    out.traces = {
      count: list.length, more: !!traces.value.next_page_token, errors: list.filter((t) => state(t).includes('ERROR')).length,
      last: times.length ? new Date(Math.max(...times)).toISOString() : null,
      latencyMs: (() => { const l = list.map((t) => num(info(t).execution_time_ms) ?? null).filter((x) => x != null).sort((a, b) => a - b); return l.length ? l[Math.floor(l.length / 2)] : null; })(),
    };
  } else out.notes.push('Traces could not be read');
  return out;
}

// ---------- SQL (for monitoring metrics and lineage system tables) ----------
const TABLE = /^[A-Za-z0-9_-]{1,255}\.[A-Za-z0-9_-]{1,255}\.[A-Za-z0-9_-]{1,255}$/;
const quote = (full) => full.split('.').map((p) => `\`${p}\``).join('.');
export const validTable = (t) => TABLE.test(String(t || '').trim());
export const validWarehouse = (w) => /^[A-Za-z0-9]{8,40}$/.test(String(w || '').trim());

async function sql(fetchImpl, base, token, warehouseId, statement, parameters = []) {
  const j = await getJson(fetchImpl, `${base}/api/2.0/sql/statements`, token, {
    timeout: 30000,
    body: { warehouse_id: warehouseId, statement, parameters, wait_timeout: '25s', on_wait_timeout: 'CANCEL', format: 'JSON_ARRAY', disposition: 'INLINE', row_limit: 500 },
  });
  if (j.status?.state !== 'SUCCEEDED') {
    const msg = String(j.status?.error?.message || '');
    // Name the table and the grant that fixes a missing privilege, instead of a cut-off Databricks message.
    const perm = msg.match(/INSUFFICIENT_PERMISSIONS[\s\S]*?Principal '([^']+)' does not have (\w+) on (?:Table|View) '([^']+)'/);
    if (perm) throw new Error(`${perm[1]} has no ${perm[2]} on ${perm[3]}. Its owner can run: GRANT ${perm[2]} ON TABLE ${perm[3]} TO \`${perm[1]}\``);
    if (/TABLE_OR_VIEW_NOT_FOUND/.test(msg)) throw new Error('The metrics table does not exist yet: wait for the monitor\'s first refresh to finish');
    throw new Error(msg ? `SQL: ${msg.slice(0, 300)}` : `SQL did not finish (${j.status?.state || 'unknown'})`);
  }
  const cols = (j.manifest?.schema?.columns || []).map((c) => c.name);
  return (j.result?.data_array || []).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}
const parseMaybe = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };
const pick = (v, keys) => { const o = parseMaybe(v); if (o && typeof o === 'object') { for (const k of keys) if (num(o[k]) != null) return num(o[k]); return null; } return num(o); };

// ---------- Production monitoring (Databricks data profiling, formerly Lakehouse Monitoring) ----------
async function tableInfo(fetchImpl, base, token, name) {
  return getJson(fetchImpl, `${base}/api/2.1/unity-catalog/tables/${encodeURIComponent(name)}`, token, { notFound: `Table ${name} was not found, or the token cannot read it` });
}
async function monitorOf(fetchImpl, base, token, name, tableId) {
  if (tableId) {
    try {
      const j = await getJson(fetchImpl, `${base}/api/data-quality/v1/monitors/table/${encodeURIComponent(tableId)}`, token);
      const c = j.data_profiling_config || j.monitor?.data_profiling_config || j;
      if (c && (c.status || c.drift_metrics_table_name)) return c;
    } catch { /* fall back to the older quality monitor API */ }
  }
  try { return await getJson(fetchImpl, `${base}/api/2.1/unity-catalog/tables/${encodeURIComponent(name)}/monitor`, token); } catch { return null; }
}

// Thresholds for calling a column drifted: Jensen-Shannon distance above 0.1, population stability index above 0.2,
// or a Kolmogorov-Smirnov test p-value below 0.05. These are common rules of thumb, not regulatory limits.
export const DRIFT = { js: 0.1, psi: 0.2, ksP: 0.05 };

export async function readMonitoring({ base, token, table, warehouseId }, { fetchImpl = fetch } = {}) {
  const name = String(table || '').trim();
  if (!validTable(name)) throw new Error('The monitored table must be named catalog.schema.table');
  const out = { table: name, monitor: null, drift: null, performance: null, notes: [] };
  const t = await tableInfo(fetchImpl, base, token, name);
  const m = await monitorOf(fetchImpl, base, token, name, t.table_id);
  if (!m) { out.notes.push('No monitor on this table. Create one in Catalog Explorer: table → Quality → Configure.'); return out; }
  out.monitor = { status: String(m.status || '').replace(/^MONITOR_STATUS_/, '') || 'unknown', failure: String(m.latest_monitor_failure_message || '').slice(0, 300),
    driftTable: m.drift_metrics_table_name || '', profileTable: m.profile_metrics_table_name || '', dashboardId: m.dashboard_id || '' };
  if (!warehouseId) { out.notes.push('Add a SQL warehouse ID to read drift and performance values.'); return out; }
  if (!validWarehouse(warehouseId)) { out.notes.push('The SQL warehouse ID does not look right.'); return out; }
  const driftQ = validTable(out.monitor.driftTable)
    ? sql(fetchImpl, base, token, warehouseId, `SELECT * FROM ${quote(out.monitor.driftTable)} WHERE column_name <> ':table' ORDER BY window.end DESC LIMIT 300`) : null;
  const profQ = validTable(out.monitor.profileTable)
    ? sql(fetchImpl, base, token, warehouseId, `SELECT * FROM ${quote(out.monitor.profileTable)} WHERE column_name = ':table' ORDER BY window.end DESC LIMIT 20`) : null;
  const [dr, pr] = await Promise.allSettled([driftQ, profQ]);
  if (driftQ && dr.status === 'fulfilled') {
    const rows = dr.value;
    const end = (r) => (parseMaybe(r.window) || {}).end || r.window_end || null;
    const latest = rows.length ? end(rows[0]) : null;
    const cur = rows.filter((r) => end(r) === latest && (!r.slice_key || r.slice_key === 'null'));
    const cols = cur.map((r) => ({
      column: String(r.column_name).slice(0, 120), type: String(r.drift_type || '').slice(0, 20),
      js: num(r.js_distance), psi: num(r.population_stability_index), ksP: pick(r.ks_test, ['pvalue', 'p_value']),
    }));
    const drifted = cols.filter((c) => (c.js != null && c.js > DRIFT.js) || (c.psi != null && c.psi > DRIFT.psi) || (c.ksP != null && c.ksP < DRIFT.ksP));
    out.drift = { windowEnd: latest, checked: cols.length, drifted: drifted.slice(0, 15) };
  } else if (driftQ) out.notes.push(`Drift metrics: ${dr.reason?.message || 'not readable'}`);
  if (profQ && pr.status === 'fulfilled') {
    const rows = pr.value;
    const r = rows.find((x) => !x.slice_key || x.slice_key === 'null') || rows[0];
    if (r) {
      const perf = {};
      for (const k of ['accuracy_score', 'roc_auc', 'log_loss', 'mean_squared_error', 'root_mean_squared_error', 'mean_absolute_error', 'r2_score']) if (num(r[k]) != null) perf[k] = num(r[k]);
      for (const k of ['precision', 'recall', 'f1_score']) { const v = pick(r[k], ['weighted', 'macro']); if (v != null) perf[k] = v; }
      out.performance = { windowEnd: (parseMaybe(r.window) || {}).end || null, rows: num(r.count), metrics: perf };
    }
  } else if (profQ) out.notes.push(`Profile metrics: ${pr.reason?.message || 'not readable'}`);
  return out;
}

// ---------- Unity Catalog tables: owner, description, columns, lineage, monitoring ----------
export async function readTables({ base, token, tables, warehouseId }, { fetchImpl = fetch } = {}) {
  const names = [...new Set((tables || []).map((t) => String(t).trim()).filter(Boolean))].slice(0, 20);
  const bad = names.filter((t) => !validTable(t));
  if (bad.length) throw new Error(`Name tables as catalog.schema.table: ${bad.slice(0, 3).join(', ')}`);
  let lineageRows = null; let lineageNote = '';
  if (warehouseId && validWarehouse(warehouseId) && names.length) {
    try {
      const params = names.map((n, i) => ({ name: `t${i}`, value: n }));
      const list = names.map((_, i) => `:t${i}`).join(', ');
      lineageRows = await sql(fetchImpl, base, token, warehouseId,
        `SELECT source_table_full_name, target_table_full_name, max(event_time) AS last_seen FROM system.access.table_lineage
         WHERE (target_table_full_name IN (${list}) OR source_table_full_name IN (${list})) AND event_time >= current_date() - INTERVAL 365 DAYS
         GROUP BY source_table_full_name, target_table_full_name LIMIT 500`, params);
    } catch (e) {
      const m = e.message.match(/Principal '([^']+)' does not have ([A-Z ]+) on (Catalog|Schema|Table) '([^']+)'/);
      lineageNote = m ? `The lineage system table is not readable (${m[1]} has no ${m[2]} on ${m[3].toLowerCase()} ${m[4]}), so lineage came from Databricks' lineage endpoint instead`
        : `The lineage system table is not readable (${e.message}), so lineage came from Databricks' lineage endpoint instead`;
    }
  }
  const one = async (name) => {
    const t = await tableInfo(fetchImpl, base, token, name);
    const r = {
      name, owner: String(t.owner || '').slice(0, 200), comment: String(t.comment || '').slice(0, 500), type: String(t.table_type || ''),
      format: String(t.data_source_format || ''), columns: (t.columns || []).length, createdBy: String(t.created_by || '').slice(0, 200),
      updatedAt: iso(t.updated_at), upstream: [], downstream: [], lineageSource: null, monitor: null,
    };
    if (lineageRows) {
      r.upstream = [...new Set(lineageRows.filter((x) => x.target_table_full_name === name && x.source_table_full_name).map((x) => x.source_table_full_name))].slice(0, 30);
      r.downstream = [...new Set(lineageRows.filter((x) => x.source_table_full_name === name && x.target_table_full_name).map((x) => x.target_table_full_name))].slice(0, 30);
      r.lineageSource = 'system.access.table_lineage';
    } else {
      try {
        // Not in Databricks' public API reference: used only when no SQL warehouse is given.
        const j = await getJson(fetchImpl, `${base}/api/2.0/lineage-tracking/table-lineage?table_name=${encodeURIComponent(name)}&include_entity_lineage=false`, token);
        const full = (x) => { const i = x.tableInfo || {}; return [i.catalog_name, i.schema_name, i.name].every(Boolean) ? `${i.catalog_name}.${i.schema_name}.${i.name}` : null; };
        r.upstream = [...new Set((j.upstreams || []).map(full).filter(Boolean))].slice(0, 30);
        r.downstream = [...new Set((j.downstreams || []).map(full).filter(Boolean))].slice(0, 30);
        r.lineageSource = 'lineage API (unofficial)';
      } catch { /* no lineage available */ }
    }
    const m = await monitorOf(fetchImpl, base, token, name, t.table_id);
    if (m) r.monitor = { status: String(m.status || '').replace(/^MONITOR_STATUS_/, '') || 'unknown' };
    return r;
  };
  const results = await Promise.allSettled(names.map(one));
  return {
    tables: results.map((x, i) => (x.status === 'fulfilled' ? x.value : { name: names[i], error: x.reason?.message || 'Could not read the table' })),
    notes: lineageNote ? [lineageNote] : [],
  };
}
