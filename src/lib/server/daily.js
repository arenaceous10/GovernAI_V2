// The daily job (GET /api/daily, called by the Vercel schedule). Two things, both best effort:
//   1. Reads the model registry of every connected product (oldest read first) to see whether a new version has
//      appeared or the saved token has stopped working. It changes nothing in the database: the product is updated
//      when someone opens it (the app re-reads a registry that was last read more than 12 hours ago), through the
//      same rule as "Check now", so one place decides what a new version means.
//   2. Mails each person a digest of what needs them (returned stages, overdue actions, incident clocks, automatic
//      evidence about to expire, reviews due, what the registry check found). Nothing is sent when nothing needs them.
// It needs the Supabase service role key, because it reads across organisations (it only reads). Without it the job
// does nothing.
import { buildDigests, renderDigest } from '../../engine/digest.js';
import { registryOpen } from '../registryStage.js';

const AUTH = /refused the token|\b401\b|\b403\b|unauthor|forbidden|invalid.*token|expired/i;

export async function runDaily({ env = process.env, fetchImpl = fetch, now = new Date(), readOne, max = 25, budgetMs = 40000 } = {}) {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) return { ok: false, reason: 'The database address is not set' };
  if (!key) return { ok: false, reason: 'SUPABASE_SERVICE_ROLE_KEY is not set' };
  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const get = async (path) => { const r = await fetchImpl(`${url}/rest/v1/${path}`, { headers: h }); if (!r.ok) throw new Error(`read ${path.split('?')[0]} failed`); return r.json(); };
  const [rows, profiles, settingRows] = await Promise.all([
    get('v2_products?select=id,client_id,data&limit=2000'),
    get('v2_profiles?select=id,email,name,role,client_id,status&status=eq.active&limit=2000'),
    get('v2_settings?select=key,value&key=eq.settings'),
  ]);
  const settings = settingRows?.[0]?.value || {};
  const products = (rows || []).filter((r) => r?.data && typeof r.data === 'object').map((r) => ({ ...r.data, id: r.id, clientId: r.client_id ?? r.data.clientId }));
  // 1. registry reads
  const t = new Date(now).getTime();
  const due = products.filter((x) => x.connector?.tokenSealed !== undefined && x.connector?.host && registryOpen(x) && !['Draft', 'Withdrawn', 'Retired'].includes(x.status)
    && !(x.connector.lastSync && t - new Date(x.connector.lastSync).getTime() < 20 * 3600000))
    .sort((a, b) => String(a.connector.lastSync || '').localeCompare(String(b.connector.lastSync || ''))).slice(0, max);
  const reads = {}; let failed = 0; const began = Date.now();
  if (readOne && env.CONNECTOR_KEY) {
    for (const x of due) {
      if (Date.now() - began > budgetMs) break;
      const row = { product_id: x.id, read_at: new Date(now).toISOString(), result: null, error: null };
      try { row.result = await readOne(x.connector, x.id); } catch (e) { failed++; row.error = AUTH.test(String(e?.message || '')) ? 'auth' : 'other'; }
      reads[x.id] = row;
    }
  }
  // 2. digests
  const people = (profiles || []).map((p) => ({ id: p.id, email: p.email, name: p.name, role: p.role, clientId: p.client_id, status: p.status }));
  const digests = buildDigests(products, people, { now, settings, reads });
  let sent = 0;
  if (env.RESEND_API_KEY && env.DIGEST_FROM) {
    for (const d of digests.slice(0, 90)) {   // the free mail plan allows 100 a day
      const m = renderDigest(d, { appUrl: env.APP_URL || '' });
      try {
        const r = await fetchImpl('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: env.DIGEST_FROM, to: [d.to], subject: m.subject, text: m.text, html: m.html }) });
        if (r.ok) sent++;
      } catch { /* one failed mail does not stop the rest */ }
    }
  }
  return { ok: true, checked: Object.keys(reads).length, failed, digests: digests.length, sent };
}
