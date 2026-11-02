// A small in-memory stand-in for Supabase's REST API (PostgREST), enough for GovernAI's cloud mode.
// install(context, db) intercepts https://fake.supabase.co/rest/v1/*. db.fail controls injected failures.
const HOST = 'https://fake.supabase.co';
const newDb = () => ({ tables: { v2_products: [], v2_clients: [], v2_users: [], v2_audit: [], v2_settings: [] }, fail: null, nextId: 1, calls: [], files: {} });
const KEYS = { v2_products: 'id', v2_clients: 'id', v2_users: 'id', v2_settings: 'key', v2_audit: 'id' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

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

// Storage: upload, signed link, download, delete for the evidence bucket.
function installStorage(context, db) {
  return context.route(`${HOST}/storage/v1/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const p = decodeURIComponent(url.pathname.replace('/storage/v1/', ''));
    db.calls.push(`${method} storage ${p}`);
    if (db.failStorage) return route.fulfill({ status: 500, headers: CORS, contentType: 'application/json', body: JSON.stringify({ message: 'storage down' }) });
    let m;
    if (method === 'POST' && (m = p.match(/^object\/sign\/([^/]+)\/(.+)$/))) {
      if (!db.files[m[2]]) return route.fulfill({ status: 404, headers: CORS, contentType: 'application/json', body: JSON.stringify({ message: 'Object not found' }) });
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ signedURL: `/object/sign/${m[1]}/${encodeURI(m[2])}?token=t` }) });
    }
    if (method === 'GET' && (m = p.match(/^object\/sign\/([^/]+)\/(.+)$/))) {
      const f = db.files[m[2]];
      return f ? route.fulfill({ status: 200, headers: CORS, contentType: f.type, body: f.body }) : route.fulfill({ status: 404, headers: CORS, body: 'missing' });
    }
    if (method === 'POST' && (m = p.match(/^object\/([^/]+)\/(.+)$/))) {
      const f = parseUpload(req.postDataBuffer() || Buffer.from(''), req.headers()['content-type'] || '');
      // Playwright cannot see file bodies inside multipart uploads; tests can supply contents by file name.
      if (!f.body.length && db.fixtures) { const hit = Object.keys(db.fixtures).find((n) => m[2].endsWith(n)); if (hit) f.body = Buffer.from(db.fixtures[hit]); }
      db.files[m[2]] = f;
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ Key: `${m[1]}/${m[2]}` }) });
    }
    if (method === 'DELETE' && (m = p.match(/^object\/([^/]+)$/))) {
      const { prefixes = [] } = JSON.parse(req.postData() || '{}'); prefixes.forEach((k) => delete db.files[k]);
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '[]' });
    }
    return route.fulfill({ status: 404, headers: CORS, body: '' });
  });
}

async function install(context, db) {
  await installStorage(context, db);
  return context.route(`${HOST}/rest/v1/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const table = url.pathname.split('/').pop(); const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const rows = db.tables[table];
    db.calls.push(`${method} ${table}`);
    if (!rows) return route.fulfill({ status: 404, headers: CORS, contentType: 'application/json', body: JSON.stringify({ message: 'no such table' }) });
    const f = db.fail;
    if (f && (f.method === '*' || f.method === method) && (!f.table || f.table === table)) {
      return route.fulfill({ status: f.status || 500, headers: CORS, contentType: 'application/json', body: JSON.stringify({ message: f.message || 'injected failure' }) });
    }
    const params = [...url.searchParams.entries()];
    if (method === 'GET') {
      let out = rows.filter((r) => matches(r, params));
      const order = url.searchParams.get('order');
      if (order) { const [col, dir] = order.split('.'); out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (dir === 'desc' ? -1 : 1)); }
      const limit = url.searchParams.get('limit'); if (limit) out = out.slice(0, Number(limit));
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(out) });
    }
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '[]'); const list = Array.isArray(body) ? body : [body];
      const upsert = /merge-duplicates/.test(req.headers().prefer || ''); const key = KEYS[table];
      for (const r of list) {
        if (upsert) { const i = rows.findIndex((x) => x[key] === r[key]); if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ ...r }); }
        else rows.push({ id: table === 'v2_audit' ? db.nextId++ : r.id, ...r });
      }
      return route.fulfill({ status: 201, headers: CORS, body: '' });
    }
    if (method === 'DELETE') {
      db.tables[table] = rows.filter((r) => !matches(r, params));
      return route.fulfill({ status: 204, headers: CORS, body: '' });
    }
    return route.fulfill({ status: 405, headers: CORS, body: '' });
  });
}
module.exports = { install, newDb, HOST };
