// A small in-memory stand-in for Supabase (Auth, PostgREST and Storage), enough for GovernAI's signed-in mode.
// install(context, db) intercepts https://fake.supabase.co/*. It mirrors the row-level security rules in
// supabase/migrations/003_auth_rbac.sql, so tests see what each role would really get back.
const HOST = 'https://fake.supabase.co';
const PASSWORD = 'Passw0rd!';
const KEYS = { v2_products: 'id', v2_clients: 'id', v2_users: 'id', v2_settings: 'key', v2_audit: 'id', v2_profiles: 'id', v2_notes: 'id', v2_ledger: 'hash' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

const newDb = () => ({
  tables: { v2_products: [], v2_clients: [], v2_users: [], v2_audit: [], v2_settings: [], v2_profiles: [], v2_notes: [], v2_ledger: [] },
  accounts: [], tokens: {}, autoConfirm: true, fail: null, failStorage: false, nextId: 1, calls: [], files: {}, denied: [],
});

// ---------- accounts ----------
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}${Math.random().toString(16).slice(2, 2)}`;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sessionFor(db, acc) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: acc.id, email: acc.email, role: 'authenticated', aud: 'authenticated', exp })}.sig${seq++}`;
  const refresh = `r-${acc.id}-${seq++}`;
  db.tokens[token] = acc.id; db.tokens[refresh] = acc.id;
  return { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: refresh, user: userJson(acc) };
}
const userJson = (a) => ({ id: a.id, aud: 'authenticated', role: 'authenticated', email: a.email, email_confirmed_at: a.confirmed ? new Date().toISOString() : null, user_metadata: a.meta, app_metadata: { provider: 'email' }, identities: [{ id: a.id, provider: 'email' }], created_at: new Date().toISOString() });

// Same logic as the gov_handle_new_user trigger.
function createAccount(db, { email, password, meta = {}, confirmed = db.autoConfirm }) {
  const acc = { id: uuid(), email: email.toLowerCase(), password, meta, confirmed };
  db.accounts.push(acc);
  const side = meta.side === 'team' ? 'team' : 'client';
  const company = (meta.company || '').trim() || null;
  let clientId = null; let status = 'pending';
  if (side === 'client' && company) {
    const found = db.tables.v2_clients.find((c) => c.name.toLowerCase() === company.toLowerCase());
    if (found) clientId = found.id; else { clientId = `cli-${Math.random().toString(16).slice(2, 12)}`; db.tables.v2_clients.push({ id: clientId, name: company }); }   // migration 005: new organisations wait too
  }
  db.tables.v2_profiles.push({
    id: acc.id, email: acc.email, name: (meta.name || '').trim() || acc.email.split('@')[0], side,
    role: side === 'client' ? 'client' : null, requested_role: side === 'team' && ['assessor', 'lead'].includes(meta.requested_role) ? meta.requested_role : null,
    company, client_id: clientId, status, created_at: new Date(Date.now() + seq).toISOString(),
  });
  return acc;
}
// Ready-made people for tests: one per role (and one client per demo organisation). Password: PASSWORD.
function addPeople(db) {
  const make = (email, name, role, clientId) => {
    const acc = createAccount(db, { email, password: PASSWORD, meta: { name, side: role === 'client' ? 'client' : 'team' } });
    const pr = db.tables.v2_profiles.find((p) => p.id === acc.id); Object.assign(pr, { role, client_id: clientId || null, status: 'active' });
  };
  make('priya@northwind.test', 'Priya Nair', 'client', 'northwind');
  make('arjun@meridian.test', 'Arjun Mehta', 'client', 'meridian');
  make('isha@lotus.test', 'Isha Banerjee', 'client', 'lotus');
  make('reviewer@gov.test', 'Ananya Rao', 'assessor');
  make('lead@gov.test', 'Vikram Shah', 'lead');
  make('admin@gov.test', 'Neha Gupta', 'admin');
}
// Demo data straight into the tables (same rows the app writes).
async function seedData(db) {
  const { buildSeed } = await import('../../src/store/seed.js');
  const sync = await import('../../src/store/sync.js');
  const s = buildSeed();
  db.tables.v2_clients.push(...s.clients.map(sync.clientRow));
  db.tables.v2_products.push(...s.systems.map(sync.productRow));
  for (const r of db.tables.v2_products) ledgerProduct(db, null, r, 'system');
  db.tables.v2_notes.push(...s.notes.map(sync.noteRow));
  db.tables.v2_audit.push(...[...s.audit].reverse().map((e) => ({ id: db.nextId++, ...sync.auditRow(e) })));
  db.tables.v2_settings.push({ key: 'settings', value: { aiQuestions: true, enabledFrameworks: ['EU_AI_ACT', 'GDPR', 'DPDP'], cutoffs: {} } }, { key: 'bankOverrides', value: {} });
}
async function seededDb() { const db = newDb(); await seedData(db); addPeople(db); return db; }

// ---------- tamper-evident record (mirror of the triggers in 007_ledger_and_ops.sql) ----------
const crypto = require('node:crypto');
function ledgerAppend(db, chain, clientId, kind, data, actor) {
  const mine = db.tables.v2_ledger.filter((r) => r.chain === chain);
  const last = mine[mine.length - 1];
  const seq = (last?.seq || 0) + 1; const prev = last?.hash || '0'.repeat(64); const at = new Date().toISOString();
  const body = JSON.stringify({ chain, seq, at, kind, actor: actor || 'system', data });
  db.tables.v2_ledger.push({ chain, seq, client_id: clientId, at, kind, actor: actor || 'system', body, prev, hash: crypto.createHash('sha256').update(`${prev}\n${body}`).digest('hex') });
}
function ledgerProduct(db, before, after, actor) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!after) { ledgerAppend(db, before.id, before.client_id, 'deleted', { name: before.data?.name, code: before.data?.code, status: before.data?.status, stage: before.data?.stage }, actor); return; }
  const d = after.data || {}; const o = before?.data;
  if (!before) ledgerAppend(db, after.id, after.client_id, 'registered', { name: d.name, code: d.code, status: d.status, stage: d.stage }, actor);
  else {
    if (o.status !== d.status) ledgerAppend(db, after.id, after.client_id, 'status', { from: o.status, to: d.status }, actor);
    if (o.stage !== d.stage) ledgerAppend(db, after.id, after.client_id, 'stage', { from: o.stage, to: d.stage }, actor);
  }
  const keys = [...new Set([...Object.keys(d.stages || {}), ...Object.keys(o?.stages || {})])].sort((a, b) => a - b);
  for (const k of keys) {
    const nl = d.stages?.[k]?.log || []; const ol = o?.stages?.[k]?.log || [];
    for (const e of nl) if (!ol.some((x) => same(x, e))) ledgerAppend(db, after.id, after.client_id, 'decision', { stage: k, entry: e }, actor);
    for (const e of ol) if (!nl.some((x) => same(x, e))) ledgerAppend(db, after.id, after.client_id, 'decision-removed', { stage: k, entry: e }, actor);
  }
}

// ---------- row-level security (mirror of 003_auth_rbac.sql) ----------
function who(db, req) {
  const auth = req.headers().authorization || '';
  const id = db.tokens[auth.replace(/^Bearer\s+/i, '')];
  const p = id && db.tables.v2_profiles.find((x) => x.id === id);
  const role = p && p.status === 'active' ? p.role : null;
  return { id, role, client: role === 'client' ? p.client_id : null, team: ['assessor', 'lead', 'admin'].includes(role) };
}
const canRead = (u, t, r) => {
  if (!u.id) return false;
  switch (t) {
    case 'v2_products': return u.team || (u.client && r.client_id === u.client);
    case 'v2_clients': return u.team || (u.client && r.id === u.client);
    case 'v2_profiles': return r.id === u.id || u.role === 'admin';
    case 'v2_notes': return u.team;
    case 'v2_audit': return u.team || (u.client && r.org === u.client);
    case 'v2_ledger': return u.team || (u.client && r.client_id === u.client);
    case 'v2_settings': return true;
    default: return u.role === 'admin';
  }
};
const canWrite = (u, t, r, existing, method) => {
  if (!u.role) return false;
  switch (t) {
    case 'v2_products':
      if (method === 'DELETE') return u.role === 'admin' || (u.client && r.client_id === u.client && r.status === 'Draft');
      if (!existing) return u.team || (u.client && r.client_id === u.client);   // migration 005: team may write
      return (u.team || (u.client && existing.client_id === u.client)) && (u.team || r.client_id === u.client);
    case 'v2_notes': return method === 'DELETE' ? u.role === 'admin' : ['assessor', 'lead', 'admin'].includes(u.role);
    case 'v2_audit': return method === 'DELETE' ? u.role === 'admin' : (!r.org || r.org === u.client || u.team);
    case 'v2_ledger': return false;   // written only by the database
    default: return u.role === 'admin';   // clients, profiles, settings, users
  }
};

function matches(row, params) {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    const [op, ...rest] = v.split('.'); const val = rest.join('.');
    const cell = row[k];
    if (op === 'eq' && String(cell) !== val) return false;
    if (op === 'neq' && String(cell) === val) return false;
    if (op === 'gte' && !(Number(cell) >= Number(val))) return false;
    if (op === 'in') { const list = val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')); if (!list.includes(String(cell))) return false; }
  }
  return true;
}
const json = (route, status, body) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
const rlsError = (route) => json(route, 403, { code: '42501', message: 'new row violates row-level security policy' });

function installAuth(context, db) {
  return context.route(`${HOST}/auth/v1/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const method = req.method(); const path = url.pathname.replace('/auth/v1/', '');
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    db.calls.push(`${method} auth ${path}`);
    const body = (() => { try { return JSON.parse(req.postData() || '{}'); } catch { return {}; } })();
    if (path === 'signup' && method === 'POST') {
      if (db.accounts.some((a) => a.email === String(body.email).toLowerCase())) return json(route, 200, { ...userJson(db.accounts.find((a) => a.email === String(body.email).toLowerCase())), identities: [] });
      const acc = createAccount(db, { email: body.email, password: body.password, meta: body.data || {} });
      return json(route, 200, acc.confirmed ? sessionFor(db, acc) : userJson(acc));
    }
    if (path === 'token' && method === 'POST') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const acc = db.accounts.find((a) => a.email === String(body.email).toLowerCase() && a.password === body.password);
        if (!acc) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' });
        if (!acc.confirmed) return json(route, 400, { code: 'email_not_confirmed', msg: 'Email not confirmed', error_description: 'Email not confirmed' });
        return json(route, 200, sessionFor(db, acc));
      }
      if (grant === 'refresh_token') {
        const acc = db.accounts.find((a) => a.id === db.tokens[body.refresh_token]);
        return acc ? json(route, 200, sessionFor(db, acc)) : json(route, 400, { msg: 'Invalid Refresh Token' });
      }
    }
    if (path === 'user') {
      const acc = db.accounts.find((a) => a.id === db.tokens[(req.headers().authorization || '').replace(/^Bearer\s+/i, '')]);
      if (!acc) return json(route, 401, { msg: 'invalid JWT' });
      if (method === 'PUT') { if (body.password) acc.password = body.password; }
      return json(route, 200, userJson(acc));
    }
    if (path === 'logout') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (path === 'recover') { db.recovered = body.email; return json(route, 200, {}); }
    return json(route, 404, { msg: 'not found' });
  });
}

// supabase-js sends files as multipart form data; keep the file part like Supabase does.
function parseUpload(buf, ct) {
  const bm = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!/multipart/i.test(ct) || !bm) return { body: buf, type: ct || 'application/octet-stream' };
  const parts = buf.toString('latin1').split('--' + (bm[1] || bm[2]));
  for (const part of parts) {
    const i = part.indexOf('\r\n\r\n'); if (i < 0) continue;
    const head = part.slice(0, i); if (!/content-type/i.test(head)) continue;
    const type = (head.match(/content-type:\s*([^\r\n]+)/i) || [])[1] || 'application/octet-stream';
    return { body: Buffer.from(part.slice(i + 4).replace(/\r\n$/, ''), 'latin1'), type };
  }
  return { body: buf, type: 'application/octet-stream' };
}

function installStorage(context, db) {
  return context.route(`${HOST}/storage/v1/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const p = decodeURIComponent(url.pathname.replace('/storage/v1/', ''));
    db.calls.push(`${method} storage ${p}`);
    if (db.failStorage) return json(route, 500, { message: 'storage down' });
    let m;
    if (method === 'POST' && (m = p.match(/^object\/sign\/([^/]+)\/(.+)$/))) {
      if (!db.files[m[2]]) return json(route, 404, { message: 'Object not found' });
      return json(route, 200, { signedURL: `/object/sign/${m[1]}/${encodeURI(m[2])}?token=t` });
    }
    if (method === 'GET' && (m = p.match(/^object\/sign\/([^/]+)\/(.+)$/))) {
      const f = db.files[m[2]];
      return f ? route.fulfill({ status: 200, headers: CORS, contentType: f.type, body: f.body }) : route.fulfill({ status: 404, headers: CORS, body: 'missing' });
    }
    if (method === 'POST' && (m = p.match(/^object\/([^/]+)\/(.+)$/))) {
      const u = who(db, req); const prod = db.tables.v2_products.find((x) => x.id === m[2].split('/')[0]);
      if (!u.client || !prod || prod.client_id !== u.client) return rlsError(route);
      const f = parseUpload(req.postDataBuffer() || Buffer.from(''), req.headers()['content-type'] || '');
      // Playwright cannot see file bodies inside multipart uploads; tests can supply contents by file name.
      if (!f.body.length && db.fixtures) { const hit = Object.keys(db.fixtures).find((n) => m[2].endsWith(n)); if (hit) f.body = Buffer.from(db.fixtures[hit]); }
      db.files[m[2]] = f;
      return json(route, 200, { Key: `${m[1]}/${m[2]}` });
    }
    if (method === 'DELETE' && (m = p.match(/^object\/([^/]+)$/))) {
      const { prefixes = [] } = JSON.parse(req.postData() || '{}'); prefixes.forEach((k) => delete db.files[k]);
      return json(route, 200, []);
    }
    return route.fulfill({ status: 404, headers: CORS, body: '' });
  });
}

function installRest(context, db) {
  return context.route(`${HOST}/rest/v1/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const table = url.pathname.split('/').pop(); const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const rows = db.tables[table];
    db.calls.push(`${method} ${table}`);
    if (!rows) return json(route, 404, { message: 'no such table' });
    const f = db.fail;
    if (f && (f.method === '*' || f.method === method) && (!f.table || f.table === table)) return json(route, f.status || 500, { message: f.message || 'injected failure' });
    const u = who(db, req); const key = KEYS[table];
    const params = [...url.searchParams.entries()];
    const deny = (what) => { db.denied.push(`${method} ${table} ${what}`); return rlsError(route); };
    if (method === 'GET' || (method === 'HEAD')) {
      let out = rows.filter((r) => canRead(u, table, r)).filter((r) => matches(r, params));
      const order = url.searchParams.get('order');
      if (order) { const [col, dir] = order.split('.'); out = [...out].sort((a, b) => (typeof a[col] === 'number' && typeof b[col] === 'number' ? a[col] - b[col] : String(a[col]).localeCompare(String(b[col]))) * (dir === 'desc' ? -1 : 1)); }
      const limit = url.searchParams.get('limit'); if (limit) out = out.slice(0, Number(limit));
      const single = /vnd\.pgrst\.object/.test(req.headers().accept || '');
      if (single) return out.length ? json(route, 200, out[0]) : json(route, 406, { code: 'PGRST116', message: 'no rows' });
      return json(route, 200, out);
    }
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '[]'); const list = Array.isArray(body) ? body : [body];
      const upsert = /merge-duplicates/.test(req.headers().prefer || '');
      const ignore = /ignore-duplicates/.test(req.headers().prefer || '');
      if (ignore) { for (let i = list.length - 1; i >= 0; i--) if (rows.some((x) => x[key] === list[i][key])) list.splice(i, 1); }
      for (const r of list) {
        const existing = upsert ? rows.find((x) => x[key] === r[key]) : null;
        if (existing && !canRead(u, table, existing)) return deny(r[key]);
        // Like Postgres: INSERT ... ON CONFLICT DO UPDATE checks the proposed row against the INSERT policy too.
        if (upsert && existing && !canWrite(u, table, r, null, method)) return deny(r[key]);
        if (!canWrite(u, table, r, existing, method)) return deny(r[key]);
        // Mirror of 008_withdrawal_guard.sql for people outside the governance team.
        if (table === 'v2_products' && existing && !u.team) {
          if (existing.data?.status === 'Withdrawn') return json(route, 400, { code: '42501', message: 'This product was withdrawn: only the governance team can change it' });
          const ow = existing.data?.withdrawal; const nw = r.data?.withdrawal;
          if (JSON.stringify(ow) !== JSON.stringify(nw) && (!nw || !['requested', 'cancelled'].includes(nw.status) || nw.decidedAt || nw.previousStatus)) return json(route, 400, { code: '42501', message: 'Only the governance team can decide a withdrawal' });
          if (r.data?.status === 'Withdrawn') return json(route, 400, { code: '42501', message: 'Only the governance team can decide a withdrawal' });
        }
      }
      for (const r of list) {
        const before = table === 'v2_products' ? rows.find((x) => x[key] === r[key]) : null;
        if (upsert) { const i = rows.findIndex((x) => x[key] === r[key]); if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ ...r }); }
        else rows.push({ id: table === 'v2_audit' ? db.nextId++ : r.id, ...r });
        if (table === 'v2_products') ledgerProduct(db, before ? JSON.parse(JSON.stringify(before)) : null, rows.find((x) => x[key] === r[key]), u.role);
        if (table === 'v2_audit') { const p = db.tables.v2_products.find((x) => x.id === r.target); if (p) ledgerAppend(db, p.id, p.client_id, 'audit', { action: r.action, detail: r.detail, by: r.actor_name, role: r.actor, at: r.at }, u.role); }
      }
      return route.fulfill({ status: 201, headers: CORS, body: '' });
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(req.postData() || '{}');
      const hit = rows.filter((r) => canRead(u, table, r) && matches(r, params));
      for (const r of hit) if (!canWrite(u, table, { ...r, ...patch }, r, method)) return deny(r[key]);
      hit.forEach((r) => Object.assign(r, patch));
      return route.fulfill({ status: 204, headers: CORS, body: '' });
    }
    if (method === 'DELETE') {
      const hit = rows.filter((r) => canRead(u, table, r) && matches(r, params));
      const allowed = hit.filter((r) => canWrite(u, table, r, r, method));   // like Postgres: rows the policy rejects are silently kept
      db.tables[table] = rows.filter((r) => !allowed.includes(r));
      if (table === 'v2_products') for (const r of allowed) ledgerProduct(db, r, null, u.role);
      return route.fulfill({ status: 204, headers: CORS, body: '' });
    }
    return route.fulfill({ status: 405, headers: CORS, body: '' });
  });
}

// The app's own server functions (/api/evidence, /api/connector), run against this fake database.
// db.registry = { versions: [...] } is what the fake model registry returns.
function installApi(context, db) {
  const send = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const ctx = async (route) => {
    const req = route.request(); const u = who(db, req);
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch { /* empty */ }
    const row = db.tables.v2_products.find((r) => r.id === body.productId && canRead(u, 'v2_products', r));
    return { req, u, body, row };
  };
  const evidence = context.route('**/api/evidence', async (route) => {
    const { u, row } = await ctx(route);
    if (!u.role) return send(route, 401, { error: 'Sign in first' });
    if (!row) return send(route, 404, { error: 'Unknown product' });
    const { loadKey, buildPack } = await import('../../src/lib/server/evidence.js');
    const key = loadKey(require('./test-evidence-key.cjs').priv);
    const rows = db.tables.v2_ledger.filter((r) => r.chain === row.id).sort((a, b) => a.seq - b.seq);
    const client = db.tables.v2_clients.find((c) => c.id === row.client_id);
    const prof = db.tables.v2_profiles.find((p) => p.id === u.id);
    return send(route, 200, await buildPack({ row, rows, client, issuedTo: { name: prof?.name, role: u.role }, key }));
  });
  const connector = context.route('**/api/connector', async (route) => {
    const { u, body, row } = await ctx(route);
    db.calls.push(`API connector ${body.action}`);
    if (!u.role) return send(route, 401, { error: 'Sign in first' });
    if (!row) return send(route, 404, { error: 'Unknown product' });
    if (['seal', 'test'].includes(body.action) && !['client', 'admin'].includes(u.role)) return send(route, 403, { error: 'Only the client or an administrator can connect a model' });
    if (body.action === 'seal') return send(route, 200, { sealed: `v1.sealed-for-${row.id}` });
    if (body.action === 'test' && !/^https:\/\//.test(body.host || '')) return send(route, 502, { error: 'Only https addresses are allowed' });
    if (body.action === 'tables') {
      if (row.data?.connector?.kind !== 'databricks-uc') return send(route, 400, { error: 'Connect the model to Databricks Unity Catalog on the AI card first' });
      return send(route, 200, { tables: (body.tables || []).map((n) => db.ucTables?.[n] || { name: n, error: `Table ${n} was not found, or the token cannot read it` }), notes: [] });
    }
    const versions = (db.registry?.versions || []).slice().sort((a, b) => +b.version - +a.version);
    return send(route, 200, { model: body.model || row.data?.connector?.model, info: db.registry?.info || {}, versions, latest: versions[0]?.version || null, genai: db.registry?.genai || null, monitoring: db.registry?.monitoring || null });
  });
  return Promise.all([evidence, connector]);
}

async function install(context, db) {
  await installAuth(context, db);
  await installStorage(context, db);
  await installRest(context, db);
  await installApi(context, db);
}

// Sign in through the real sign-in form.
async function signIn(page, email, password = PASSWORD) {
  await page.getByRole('tab', { name: 'Sign in' }).waitFor({ timeout: 20000 });
  await page.getByRole('tab', { name: 'Sign in' }).click();
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.shell').waitFor({ timeout: 20000 });
  await page.waitForTimeout(300);
}
async function signOut(page) {
  await page.getByRole('button', { name: /Sign out/ }).first().click();
  await page.getByRole('tab', { name: 'Sign in' }).waitFor({ timeout: 20000 });
}
const EMAIL = { 'client:northwind': 'priya@northwind.test', client: 'priya@northwind.test', 'client:meridian': 'arjun@meridian.test', 'client:lotus': 'isha@lotus.test', assessor: 'reviewer@gov.test', lead: 'lead@gov.test', admin: 'admin@gov.test' };

module.exports = { install, newDb, seededDb, seedData, addPeople, createAccount, signIn, signOut, EMAIL, PASSWORD, HOST };
