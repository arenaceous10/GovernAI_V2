// Database layer. Pure functions plus thin calls on a Supabase-style client, so they can be tested with a fake.
// Tables: v2_clients, v2_profiles (signed-in users), v2_products (whole product in `data`), v2_audit, v2_settings,
// v2_notes (internal notes, governance team only). Row-level security decides what each signed-in user gets back.
export const T = { products: 'v2_products', audit: 'v2_audit', clients: 'v2_clients', users: 'v2_users', settings: 'v2_settings', profiles: 'v2_profiles', notes: 'v2_notes' };
export const AUDIT_LIMIT = 800;

export const productRow = (s) => ({
  id: s.id, client_id: s.clientId || null, code: s.code || null, name: s.name || null, status: s.status || null,
  stage: s.stage || 1, data: s, updated_at: s.updatedAt || s.createdAt || new Date().toISOString(),
});
export const clientRow = (c) => ({ id: c.id, name: c.name, sector: c.sector || null, contact: c.contact || null });
export const userRow = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, client_id: u.clientId || null });
export const auditRow = (e) => ({ at: e.at, actor: e.actor || null, actor_name: e.actorName || null, org: e.org || null, action: e.action, target: e.target || null, detail: e.detail || null });
export const auditFromRow = (r) => ({ at: r.at, actor: r.actor, actorName: r.actor_name || undefined, org: r.org || undefined, action: r.action, target: r.target, detail: r.detail || '' });
export const noteRow = (n) => ({ id: n.id, product_id: n.productId, stage: n.stage, at: n.at, by_role: n.byRole || null, by_name: n.byName || null, text: n.text });
export const noteFromRow = (r) => ({ id: r.id, productId: r.product_id, stage: r.stage, at: r.at, byRole: r.by_role, byName: r.by_name, text: r.text });
export const profileFromRow = (r) => ({
  id: r.id, name: r.name, email: r.email, role: r.role, side: r.side, status: r.status, requestedRole: r.requested_role || null,
  company: r.company || '', createdAt: r.created_at, ...(r.client_id ? { clientId: r.client_id } : {}),
});
export const clientFromRow = (r) => ({ id: r.id, name: r.name, sector: r.sector || '', contact: r.contact || '' });
export const userFromRow = (r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, ...(r.client_id ? { clientId: r.client_id } : {}) });

// What changed between the last saved state and the current one. Identity comparison: updates replace only the objects they change.
// opts.users = false when users are signed-in profiles managed through their own calls.
export function diffState(prev, next, opts = {}) {
  const ops = { clients: [], clientsDel: [], users: [], usersDel: [], products: [], productsDel: [], settings: [], audit: [], notes: [] };
  const byId = (xs) => new Map((xs || []).map((x) => [x.id, x]));
  const each = (pa, na, up, del) => {
    const p = byId(pa); const n = byId(na);
    for (const [id, x] of n) if (p.get(id) !== x) up.push(x);
    for (const id of p.keys()) if (!n.has(id)) del.push(id);
  };
  each(prev.clients, next.clients, ops.clients, ops.clientsDel);
  if (opts.users !== false) each(prev.users, next.users, ops.users, ops.usersDel);
  each(prev.systems, next.systems, ops.products, ops.productsDel);
  if (prev.settings !== next.settings) ops.settings.push({ key: 'settings', value: next.settings });
  if (prev.bankOverrides !== next.bankOverrides) ops.settings.push({ key: 'bankOverrides', value: next.bankOverrides || {} });
  const seen = new Set(prev.audit || []);
  ops.audit = (next.audit || []).filter((e) => !seen.has(e)).reverse();   // oldest first
  const seenNotes = new Set(prev.notes || []);
  ops.notes = (next.notes || []).filter((n) => !seenNotes.has(n));
  return ops;
}
export const isEmptyOps = (o) => Object.values(o).every((v) => v.length === 0);

const ok = async (q) => { const { error } = await q; if (error) throw Object.assign(new Error(error.message || 'Database error'), { code: error.code }); };

// Order matters: audit goes last, so a retry after a partial failure never duplicates audit rows.
export async function applyOps(db, ops) {
  if (ops.clients.length) await ok(db.from(T.clients).upsert(ops.clients.map(clientRow)));
  if (ops.users.length) await ok(db.from(T.users).upsert(ops.users.map(userRow)));
  if (ops.products.length) await ok(db.from(T.products).upsert(ops.products.map(productRow)));
  if (ops.productsDel.length) await ok(db.from(T.products).delete().in('id', ops.productsDel));
  if (ops.usersDel.length) await ok(db.from(T.users).delete().in('id', ops.usersDel));
  if (ops.clientsDel.length) await ok(db.from(T.clients).delete().in('id', ops.clientsDel));
  if (ops.notes.length) await ok(db.from(T.notes).upsert(ops.notes.map(noteRow), { onConflict: 'id', ignoreDuplicates: true }));
  if (ops.settings.length) await ok(db.from(T.settings).upsert(ops.settings.map((s) => ({ ...s, updated_at: new Date().toISOString() }))));
  if (ops.audit.length) await ok(db.from(T.audit).insert(ops.audit.map(auditRow)));
}

// A product as stored: the row's own id and organisation win over anything inside `data` (so a row cannot pose as
// another organisation's product), and rows whose shape the screens cannot draw are left out instead of crashing them.
const TIER_IDS = ['minimal', 'limited', 'high', 'unacceptable'];
export function productFromRow(r) {
  const d = r?.data;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const stage = Number(d.stage);
  if (!Number.isInteger(stage) || stage < 1 || stage > 10) return null;
  if (d.stages && (typeof d.stages !== 'object' || Array.isArray(d.stages))) return null;
  if (d.assessment) {
    const res = d.assessment.results;
    if (!res || !TIER_IDS.includes(res.tier) || !Array.isArray(d.assessment.questions) || typeof d.assessment.answers !== 'object' || !Array.isArray(d.assessment.frameworks)) return null;
  }
  for (const k of ['actions', 'datasets', 'outputs', 'events', 'history']) if (d[k] != null && !Array.isArray(d[k])) return null;
  return { ...d, id: r.id ?? d.id, clientId: r.client_id ?? undefined, actions: d.actions || [], datasets: d.datasets || [], outputs: d.outputs || [] };
}

export async function loadAll(db) {
  const get = async (q) => { const { data, error } = await q; if (error) throw new Error(error.message || 'Database error'); return data || []; };
  const [products, clients, users, audit, settings, notes] = await Promise.all([
    get(db.from(T.products).select('id,client_id,data')),
    get(db.from(T.clients).select('*')),
    get(db.from(T.profiles).select('*').order('created_at', { ascending: true })),
    get(db.from(T.audit).select('*').order('at', { ascending: false }).limit(AUDIT_LIMIT)),
    get(db.from(T.settings).select('*')),
    get(db.from(T.notes).select('*')),
  ]);
  const setting = (k) => settings.find((s) => s.key === k)?.value;
  const systems = products.map(productFromRow).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return {
    empty: !products.length && !clients.length,
    systems, clients: clients.map(clientFromRow), users: users.map(profileFromRow), audit: audit.map(auditFromRow),
    notes: notes.map(noteFromRow), settings: setting('settings'), bankOverrides: setting('bankOverrides'),
  };
}

// "Reset to demo data" (administrator): rewrites only the demo organisations and their products.
// Organisations and people who signed up themselves are left alone.
export async function resetDemo(db, seed) {
  const clientIds = seed.clients.map((c) => c.id);
  await ok(db.from(T.products).delete().in('client_id', clientIds));
  await ok(db.from(T.notes).delete().in('product_id', seed.systems.map((x) => x.id)));
  const ops = diffState({ clients: [], users: [], systems: [], audit: [], notes: [] }, seed, { users: false });
  ops.settings = [{ key: 'settings', value: seed.settings }, { key: 'bankOverrides', value: seed.bankOverrides || {} }];
  await applyOps(db, ops);
}
