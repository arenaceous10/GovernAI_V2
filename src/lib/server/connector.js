// Model-registry connector (server side): reads model versions and their run metrics from MLflow or from
// Databricks Unity Catalog, with the client's read-only token.
//
// Tokens are sealed with AES-256-GCM under CONNECTOR_KEY (server only) and bound to the product id, so the sealed
// value stored in the product is useless to anyone who reads it, and cannot be moved to another product.
// Outbound calls are limited: https only, public addresses only (checked after DNS), no redirects, 8 s timeout,
// 2 MB per response. CONNECTOR_ALLOW_LOCAL=1 (tests only) allows http://localhost.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { lookup as lookupCb } from 'node:dns';
import { isIP, BlockList } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

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

// Addresses GovernAI never calls. BlockList also matches IPv4-mapped IPv6 forms such as ::ffff:7f00:1 (127.0.0.1),
// which a URL parser produces from [::ffff:127.0.0.1] and which a text pattern would miss.
const BLOCKED = new BlockList();
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) BLOCKED.addSubnet(a, n, 'ipv4');
for (const [a, n] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['2002::', 16], ['2001::', 32], ['2001:db8::', 32], ['100::', 64]]) BLOCKED.addSubnet(a, n, 'ipv6');
export const isPrivate = (ip) => {
  const v = isIP(String(ip || ''));
  return !v || BLOCKED.check(ip, v === 6 ? 'ipv6' : 'ipv4');
};

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

// fetch() replacement for registry calls. The address is resolved and checked on every connection, so a name that
// passed checkHost cannot be re-pointed at a private address afterwards (DNS rebinding). Never follows redirects;
// stops reading past 2 MB.
const MAX_BYTES = 2_000_000;
export function safeFetch(url, { method = 'GET', headers = {}, body, signal } = {}, { allowLocal = false } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const local = allowLocal && u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
    if (u.protocol !== 'https:' && !local) { reject(new Error('Only https addresses are allowed')); return; }
    const guardLookup = (host, opts, cb) => lookupCb(host, { ...opts, all: true }, (err, addrs) => {
      if (err) { cb(err); return; }
      const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: opts?.family || 4 }];
      if (!local && list.some((a) => isPrivate(a.address))) { cb(new Error('That address is on a private network, which GovernAI cannot reach')); return; }
      if (opts?.all) cb(null, list); else cb(null, list[0].address, list[0].family);
    });
    const req = (local ? httpRequest : httpsRequest)(u, { method, headers, lookup: guardLookup, signal }, (res) => {
      let size = 0; const chunks = [];
      res.on('data', (c) => { size += c.length; if (size > MAX_BYTES) { req.destroy(new Error('The registry response was too large')); return; } chunks.push(c); });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, text: async () => text });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const defaultFetch = (url, init) => safeFetch(url, init, { allowLocal: process.env.CONNECTOR_ALLOW_LOCAL === '1' });

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
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('The registry did not return JSON'); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('The registry returned an answer GovernAI does not recognise');
  return j;
}

const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (Number.isFinite(+v) ? +v : null);
const iso = (ms) => (num(ms) != null ? new Date(+ms).toISOString() : null);

// ---------- what a training run says about how the model was made ----------
// Read with the metrics, for the newest three versions. Everything is cut to a safe length. Parameters whose names
// look like credentials are never read, and a repository address is kept without any user name or token in it.
const TABLE_NAME = /^[A-Za-z0-9_-]{1,255}\.[A-Za-z0-9_-]{1,255}\.[A-Za-z0-9_-]{1,255}$/;
const SECRET_KEY = /key|token|secret|passw|pwd|credential|auth|bearer|signature/i;
const str = (v, n) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, n) : '');
function cleanRepo(v) {
  try {
    const u = new URL(String(v || ''));
    if (!['https:', 'http:'].includes(u.protocol)) return '';
    return `${u.origin}${u.pathname}`.slice(0, 200);
  } catch { return ''; }
}
// A dataset logged with mlflow.log_input: the catalog table it came from, when it names one.
function datasetTable(d) {
  let src = null;
  try { src = JSON.parse(d.source); } catch { /* the source is not JSON */ }
  const fromSource = src && typeof src === 'object' ? [src.table_name, src.delta_table_name, src.name].find((x) => typeof x === 'string' && TABLE_NAME.test(x)) : null;
  if (fromSource) return fromSource;
  const bare = String(d.name || '').replace(/@v?\d+$/i, '');
  return TABLE_NAME.test(bare) ? bare : null;
}
export function runFacts(run) {
  const tags = Object.fromEntries(arr(run?.data?.tags).filter((t) => t && t.key != null).map((t) => [String(t.key), t.value]));
  const tag = (...keys) => { for (const k of keys) if (typeof tags[k] === 'string' && tags[k].trim()) return tags[k]; return ''; };
  let flavors = [];
  try {
    const hist = JSON.parse(tag('mlflow.log-model.history') || '[]');
    const all = [...new Set(arr(hist).flatMap((h) => Object.keys(h?.flavors || {})))].map((f) => str(f, 40));
    flavors = (all.filter((f) => f !== 'python_function').length ? all.filter((f) => f !== 'python_function') : all).slice(0, 5);
  } catch { /* no model history tag */ }
  const params = Object.fromEntries(arr(run?.data?.params).filter((x) => x && x.key != null && !SECRET_KEY.test(String(x.key))).slice(0, 25).map((x) => [str(x.key, 60), str(x.value, 80)]));
  const datasets = arr(run?.inputs?.dataset_inputs).filter((x) => x?.dataset && typeof x.dataset === 'object').slice(0, 20).map((x) => ({
    name: str(x.dataset.name, 200), table: datasetTable(x.dataset), digest: str(x.dataset.digest, 64), sourceType: str(x.dataset.source_type, 40),
    context: str(arr(x.tags).find((t) => t?.key === 'mlflow.data.context')?.value, 40),
  }));
  return {
    startedAt: iso(run?.info?.start_time), endedAt: iso(run?.info?.end_time), status: str(run?.info?.status, 20), user: str(tag('mlflow.user'), 200),
    code: {
      commit: str(tag('mlflow.source.git.commit', 'mlflow.databricks.gitRepoCommit'), 64).replace(/[^A-Za-z0-9]/g, ''),
      repo: cleanRepo(tag('mlflow.source.git.repoURL', 'mlflow.databricks.gitRepoUrl')),
      branch: str(tag('mlflow.source.git.branch', 'mlflow.databricks.gitRepoReference'), 120),
      source: str(tag('mlflow.databricks.notebookPath', 'mlflow.source.name'), 300),
    },
    flavors, params, datasets,
  };
}

// Reads up to 50 versions, newest first, with metrics for the newest 3. Returns { model, versions, latest }.
export async function readRegistry({ kind, host, model, token }, { fetchImpl = defaultFetch, allowLocal = false, resolve } = {}) {
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
    info = { description: String(rm.description || '').slice(0, 1000), owner: '', createdBy: String(rm.user_id || '').slice(0, 200),
      tags: Object.fromEntries(arr(rm.tags).filter((t) => t && t.key != null && !SECRET_KEY.test(String(t.key))).slice(0, 20).map((t) => [str(t.key, 60), str(t.value, 120)])) };
    versions = arr(j.model_versions).filter((v) => v && typeof v === 'object').map((v) => ({
      version: String(v.version), createdAt: iso(v.creation_timestamp), status: v.status || '', stage: v.current_stage || '',
      aliases: arr(v.aliases).map(String), runId: v.run_id || '', description: String(v.description || '').slice(0, 500), source: String(v.source || '').slice(0, 300),
    }));
  } else {
    if (name.split('.').length !== 3) throw new Error('Unity Catalog models are named catalog.schema.model');
    const path = name.split('.').map(encodeURIComponent).join('.');
    const [j, m] = await Promise.all([
      getJson(fetchImpl, `${base}/api/2.1/unity-catalog/models/${path}/versions?max_results=50`, token),
      getJson(fetchImpl, `${base}/api/2.1/unity-catalog/models/${path}?include_aliases=true`, token).catch(() => ({})),
    ]);
    const al = {};
    for (const a of arr(m.aliases)) (al[String(a.version_num)] ||= []).push(a.alias_name);
    info = { description: String(m.comment || '').slice(0, 1000), owner: String(m.owner || '').slice(0, 200), createdBy: String(m.created_by || '').slice(0, 200) };
    versions = arr(j.model_versions).filter((v) => v && typeof v === 'object').map((v) => ({
      version: String(v.version), createdAt: iso(v.created_at), status: v.status || '', stage: '',
      aliases: al[String(v.version)] || [], runId: v.run_id || '', description: String(v.comment || '').slice(0, 500), source: String(v.source || '').slice(0, 300),
    }));
  }
  versions.sort((a, b) => (+b.version || 0) - (+a.version || 0));
  for (const v of versions.slice(0, 3)) {
    if (!v.runId || !/^[A-Za-z0-9_-]{1,64}$/.test(v.runId)) continue;
    try {
      const r = await getJson(fetchImpl, `${base}/api/2.0/mlflow/runs/get?run_id=${encodeURIComponent(v.runId)}`, token);
      v.metrics = Object.fromEntries(arr(r.run?.data?.metrics).filter((x) => x && x.key != null).slice(0, 30).map((x) => [String(x.key).slice(0, 60), num(x.value)]).filter(([, x]) => x != null));
      if (r.run?.info?.experiment_id) v.experimentId = String(r.run.info.experiment_id).slice(0, 40);
      v.run = runFacts(r.run);
    } catch { v.metrics = {}; }
  }
  // Unity Catalog records the tables and functions a model was packaged with (feature tables). Read for the version
  // in use: the one marked champion or production, else the newest.
  if (kind === 'databricks-uc') {
    const used = versions.find((v) => (v.aliases || []).some((a) => /champion|prod/i.test(a))) || versions[0];
    if (used && /^[0-9]{1,9}$/.test(used.version)) {
      try {
        const path = name.split('.').map(encodeURIComponent).join('.');
        const j = await getJson(fetchImpl, `${base}/api/2.1/unity-catalog/models/${path}/versions/${used.version}`, token);
        const deps = arr(j.model_version_dependencies?.dependencies).filter((d) => d && typeof d === 'object');
        const tables = [...new Set(deps.map((d) => d.table?.table_full_name).filter((t) => typeof t === 'string' && TABLE_NAME.test(t)))].slice(0, 30);
        const functions = [...new Set(deps.map((d) => d.function?.function_full_name).filter((t) => typeof t === 'string' && TABLE_NAME.test(t)))].slice(0, 30);
        if (tables.length || functions.length) used.dependencies = { tables, functions };
      } catch { /* dependencies are optional */ }
    }
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

export async function readGenAI({ base, token, experiment, versions = [] }, { fetchImpl = defaultFetch } = {}) {
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
    out.evaluations = arr(runs.value.runs).filter((r) => r && typeof r === 'object').map((r) => ({
      runId: String(r.info?.run_id || '').slice(0, 64), name: String(r.info?.run_name || '').slice(0, 120), at: iso(r.info?.start_time),
      metrics: Object.fromEntries(arr(r.data?.metrics).filter((m) => m && EVAL_METRIC.test(m.key)).slice(0, 20).map((m) => [String(m.key).slice(0, 60), num(m.value)]).filter(([, v]) => v != null)),
    })).filter((r) => Object.keys(r.metrics).length).slice(0, 10);
  } else out.notes.push('Evaluation runs could not be read');
  if (traces.status === 'fulfilled') {
    const list = arr(traces.value.traces);
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
const TABLE = TABLE_NAME;
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
  const cols = arr(j.manifest?.schema?.columns).map((c) => c?.name);
  return arr(j.result?.data_array).filter(Array.isArray).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}
const parseMaybe = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };
const pick = (v, keys) => { const o = parseMaybe(v); if (o && typeof o === 'object') { for (const k of keys) if (num(o[k]) != null) return num(o[k]); return null; } return num(o); };

// Classification metrics come as { one_vs_all: { label: value }, macro, weighted }. For a two-class model the figure
// that matters is the positive class (how many true cases are caught), which a weighted average hides when the
// positive class is rare. Returns the positive label for a two-class model, or null.
const POSITIVE = ['1', '1.0', 'true', 'yes', 'positive', 'pos'];
function positiveLabel(v) {
  const o = parseMaybe(v); const ova = parseMaybe(o?.one_vs_all);
  if (!ova || typeof ova !== 'object') return null;
  const keys = Object.keys(ova);
  if (keys.length !== 2) return null;
  const named = keys.find((k) => POSITIVE.includes(String(k).toLowerCase()));
  if (named != null) return named;
  return keys.every((k) => num(k) != null) ? keys.sort((a, b) => +a - +b)[1] : null;
}
const ovaOf = (v, label) => { const o = parseMaybe(v); const ova = parseMaybe(o?.one_vs_all); return label != null && ova && typeof ova === 'object' ? num(ova[label]) : null; };
function perfOf(r, label) {
  const perf = {};
  for (const k of ['accuracy_score', 'roc_auc', 'log_loss', 'mean_squared_error', 'root_mean_squared_error', 'mean_absolute_error', 'r2_score']) if (num(r[k]) != null) perf[k] = num(r[k]);
  for (const k of ['precision', 'recall', 'f1_score']) {
    const v = pick(r[k], ['weighted', 'macro']); if (v != null) perf[k] = v;
    const p = ovaOf(r[k], label); if (p != null) perf[`${k === 'f1_score' ? 'f1' : k}_positive`] = p;
  }
  return perf;
}
// Columns that are not model inputs: identifiers always "drift" because every window holds new values.
const ID_LIKE = /(^|_)(id|uuid|guid)$/i;

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

export async function readMonitoring({ base, token, table, warehouseId }, { fetchImpl = defaultFetch } = {}) {
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
    ? sql(fetchImpl, base, token, warehouseId, `SELECT * FROM ${quote(out.monitor.profileTable)} WHERE column_name = ':table' ORDER BY window.end DESC LIMIT 200`) : null;
  const [dr, pr] = await Promise.allSettled([driftQ, profQ]);
  if (driftQ && dr.status === 'fulfilled') {
    const rows = dr.value;
    const end = (r) => (parseMaybe(r.window) || {}).end || r.window_end || null;
    const latest = rows.length ? end(rows[0]) : null;
    let cur = rows.filter((r) => end(r) === latest && (!r.slice_key || r.slice_key === 'null'));
    // The metrics table repeats each column per granularity and per model id: keep one granularity and the
    // all-models rows (model_id '*') when present, so a column is counted once.
    const gran = cur.find((r) => r.granularity)?.granularity;
    if (gran) cur = cur.filter((r) => !r.granularity || r.granularity === gran);
    if (cur.some((r) => r.model_id === '*')) cur = cur.filter((r) => r.model_id === '*');
    else { const mid = cur.find((r) => r.model_id != null)?.model_id; if (mid != null) cur = cur.filter((r) => r.model_id == null || r.model_id === mid); }
    const tsCol = m.inference_log?.timestamp_col || m.time_series?.timestamp_col || m.inference_log?.timestamp_column || m.time_series?.timestamp_column || '';
    const seenCol = new Set();
    cur = cur.filter((r) => r.column_name !== tsCol && r.column_name !== ':table' && !seenCol.has(`${r.column_name}|${r.drift_type}`) && seenCol.add(`${r.column_name}|${r.drift_type}`));
    // The label, the model id and identifier columns are not inputs to the model, so their "drift" says nothing
    // about it. They are left out and listed, so nobody wonders where they went.
    const il = m.inference_log || {};
    const notInputs = new Set([il.label_col, il.label_column, il.model_id_col, il.model_id_column].filter(Boolean));
    const skip = (c) => notInputs.has(c) || ID_LIKE.test(String(c));
    const skipped = [...new Set(cur.filter((r) => skip(r.column_name)).map((r) => String(r.column_name).slice(0, 120)))];
    cur = cur.filter((r) => !skip(r.column_name));
    const cols = cur.map((r) => ({
      column: String(r.column_name).slice(0, 120), type: String(r.drift_type || '').slice(0, 20),
      js: num(r.js_distance), psi: num(r.population_stability_index), ksP: pick(r.ks_test, ['pvalue', 'p_value']),
    }));
    const drifted = cols.filter((c) => (c.js != null && c.js > DRIFT.js) || (c.psi != null && c.psi > DRIFT.psi) || (c.ksP != null && c.ksP < DRIFT.ksP));
    // A column that drifted against both the previous window and the baseline is listed once.
    // Worst first: by Jensen-Shannon distance, then population stability index.
    const once = [...new Map(drifted.map((c) => [c.column, c])).values()].sort((a, b) => (b.js ?? -1) - (a.js ?? -1) || (b.psi ?? -1) - (a.psi ?? -1));
    out.drift = { windowEnd: latest, checked: new Set(cols.map((c) => c.column)).size, drifted: once.slice(0, 15), skipped: skipped.slice(0, 15) };
  } else if (driftQ) out.notes.push(`Drift metrics: ${dr.reason?.message || 'not readable'}`);
  if (profQ && pr.status === 'fulfilled') {
    const rows = pr.value;
    const r = rows.find((x) => (!x.slice_key || x.slice_key === 'null') && (x.model_id == null || x.model_id === '*')) || rows.find((x) => !x.slice_key || x.slice_key === 'null') || rows[0];
    if (r) {
      const endOf = (x) => (parseMaybe(x.window) || {}).end || null;
      const label = positiveLabel(r.recall) ?? positiveLabel(r.precision) ?? positiveLabel(r.f1_score);
      out.performance = { windowEnd: endOf(r), rows: num(r.count), metrics: perfOf(r, label), ...(label != null ? { positiveLabel: String(label).slice(0, 40) } : {}) };
      // The same window split by the monitor's slicing expressions (for example sex or age band), so a group the
      // model serves badly is not hidden by the overall figure.
      const slices = rows.filter((x) => x.slice_key && x.slice_key !== 'null' && endOf(x) === out.performance.windowEnd && (x.model_id == null || x.model_id === r.model_id))
        .map((x) => ({ key: String(x.slice_key).slice(0, 80), value: String(x.slice_value ?? '').slice(0, 80), rows: num(x.count), metrics: perfOf(x, label) }))
        .filter((x) => Object.keys(x.metrics).length);
      const seen = new Set();
      const uniq = slices.filter((x) => !seen.has(`${x.key}|${x.value}`) && seen.add(`${x.key}|${x.value}`)).sort((a, b) => a.key.localeCompare(b.key) || a.value.localeCompare(b.value));
      if (uniq.length) out.performance.slices = uniq.slice(0, 40);
    }
  } else if (profQ) out.notes.push(`Profile metrics: ${pr.reason?.message || 'not readable'}`);
  return out;
}

// ---------- personal data: column tags, masks and name hints ----------
// A tag marks a column as personal or sensitive when it is one of Databricks' own classification tags (class.*,
// set by Data Classification) or its name or value says so (pii, personal, sensitive, phi, restricted...). A tag
// that says the opposite (pii = false, non_pii) is not counted.
const PERSONAL_WORD = /(^|[^a-z])(pii|personal|personally|sensitive|sensitivity|phi|pci|gdpr|dpdp|special[_ -]?category|confidential|restricted)/i;
const NEGATIVE_VALUE = /^(false|no|none|n|0|non[-_ ]?pii|not[-_ ]?pii|public|low|internal|non[-_ ]?sensitive|not[-_ ]?sensitive)$/i;
export function personalTag(name, value) {
  const n = String(name || '').trim(); const v = String(value ?? '').trim();
  if (!n || /^(non|not)[-_ ]/i.test(n)) return false;
  if (/^class\./i.test(n)) return true;
  if (PERSONAL_WORD.test(n)) return !NEGATIVE_VALUE.test(v);
  return PERSONAL_WORD.test(v);
}
// Column names that usually hold personal data. A hint for a person to look at, never counted as proof either way.
const PERSONAL_NAME = /(^|_)(e_?mail|phone|mobile|msisdn|dob|date_of_birth|birth_?date|ssn|aadhaar|aadhar|pan_?(no|number)|passport|first_?name|last_?name|full_?name|surname|address|post_?code|zip_?code|pin_?code|gender|ethnicity|religion|ip_?address|national_?id|nhs_?(no|number)|iban|account_?(no|number)|card_?(no|number)|latitude|longitude)(_|$)/i;

// ---------- Unity Catalog tables: owner, description, columns, lineage, monitoring ----------
export async function readTables({ base, token, tables, warehouseId }, { fetchImpl = defaultFetch } = {}) {
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
  // Column tags come from the information schema, which needs a SQL warehouse. When they cannot be read the result
  // says so (tagsRead: false): "no tags found" and "tags not read" are different answers.
  let tagRows = null; let tagNote = '';
  if (warehouseId && validWarehouse(warehouseId) && names.length) {
    try {
      const params = names.map((n, i) => ({ name: `t${i}`, value: n }));
      const list = names.map((_, i) => `:t${i}`).join(', ');
      tagRows = await sql(fetchImpl, base, token, warehouseId,
        `SELECT catalog_name, schema_name, table_name, column_name, tag_name, tag_value FROM system.information_schema.column_tags
         WHERE concat_ws('.', catalog_name, schema_name, table_name) IN (${list}) LIMIT 500`, params);
    } catch (e) { tagNote = `Column tags could not be read (${String(e.message || '').slice(0, 160)}), so personal-data columns are not confirmed from tags`; }
  }
  const one = async (name) => {
    const t = await tableInfo(fetchImpl, base, token, name);
    const colNames = arr(t.columns).filter((c) => c && c.name != null).map((c) => String(c.name).slice(0, 120));
    const tagged = (tagRows || []).filter((x) => x && `${x.catalog_name}.${x.schema_name}.${x.table_name}` === name && x.column_name != null && personalTag(x.tag_name, x.tag_value))
      .map((x) => ({ column: String(x.column_name).slice(0, 120), tag: `${String(x.tag_name).slice(0, 60)}${String(x.tag_value ?? '').trim() && !/^(true|yes|y|1)$/i.test(String(x.tag_value).trim()) ? `=${String(x.tag_value).trim().slice(0, 40)}` : ''}` }))
      .sort((a, b) => a.column.localeCompare(b.column) || a.tag.localeCompare(b.tag));
    const taggedCols = new Set(tagged.map((x) => x.column));
    const r = {
      name, owner: String(t.owner || '').slice(0, 200), comment: String(t.comment || '').slice(0, 500), type: String(t.table_type || ''),
      format: String(t.data_source_format || ''), columns: arr(t.columns).length, createdBy: String(t.created_by || '').slice(0, 200),
      updatedAt: iso(t.updated_at), upstream: [], downstream: [], lineageSource: null, monitor: null,
      personal: {
        tagsRead: !!tagRows, tagged: tagged.slice(0, 40),
        masked: arr(t.columns).filter((c) => c && c.name != null && c.mask && typeof c.mask === 'object').map((c) => String(c.name).slice(0, 120)).slice(0, 40),
        hints: colNames.filter((c) => !taggedCols.has(c) && PERSONAL_NAME.test(c)).slice(0, 40),
      },
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
        r.upstream = [...new Set(arr(j.upstreams).map(full).filter(Boolean))].slice(0, 30);
        r.downstream = [...new Set(arr(j.downstreams).map(full).filter(Boolean))].slice(0, 30);
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
    notes: [lineageNote, tagNote].filter(Boolean),
  };
}
