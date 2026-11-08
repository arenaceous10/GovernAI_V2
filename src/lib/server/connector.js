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

async function getJson(fetchImpl, url, token) {
  const r = await fetchImpl(url, {
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    redirect: 'manual', signal: AbortSignal.timeout(8000),
  });
  if (r.status >= 300 && r.status < 400) throw new Error('The registry redirected the request, which is not followed');
  if (r.status === 401 || r.status === 403) throw new Error('The registry refused the token (check it is valid and can read this model)');
  if (r.status === 404) throw new Error('The model was not found in the registry');
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
    } catch { v.metrics = {}; }
  }
  return { model: name, info, versions: versions.slice(0, 50), latest: versions[0]?.version || null };
}
