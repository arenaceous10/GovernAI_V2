// Database layer. Pure functions plus thin calls on a Supabase-style client, so they can be tested with a fake.
// Tables: v2_clients, v2_users, v2_products (whole product in `data`), v2_audit, v2_settings.
export const T = { products: 'v2_products', audit: 'v2_audit', clients: 'v2_clients', users: 'v2_users', settings: 'v2_settings' };
export const AUDIT_LIMIT = 800;

export const productRow = (s) => ({
  id: s.id, client_id: s.clientId || null, code: s.code || null, name: s.name || null, status: s.status || null,
  stage: s.stage || 1, data: s, updated_at: s.updatedAt || s.createdAt || new Date().toISOString(),
});
export const clientRow = (c) => ({ id: c.id, name: c.name, sector: c.sector || null, contact: c.contact || null });
export const userRow = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, client_id: u.clientId || null });
export const auditRow = (e) => ({ at: e.at, actor: e.actor || null, org: e.org || null, action: e.action, target: e.target || null, detail: e.detail || null });
export const auditFromRow = (r) => ({ at: r.at, actor: r.actor, org: r.org || undefined, action: r.action, target: r.target, detail: r.detail || '' });
export const clientFromRow = (r) => ({ id: r.id, name: r.name, sector: r.sector || '', contact: r.contact || '' });
export const userFromRow = (r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, ...(r.client_id ? { clientId: r.client_id } : {}) });

// What changed between the last saved state and the current one. Identity comparison: updates replace only the objects they change.
export function diffState(prev, next) {
  const ops = { clients: [], clientsDel: [], users: [], usersDel: [], products: [], productsDel: [], settings: [], audit: [] };
  const byId = (xs) => new Map((xs || []).map((x) => [x.id, x]));
  const each = (pa, na, up, del) => {
    const p = byId(pa); const n = byId(na);
    for (const [id, x] of n) if (p.get(id) !== x) up.push(x);
    for (const id of p.keys()) if (!n.has(id)) del.push(id);
  };
  each(prev.clients, next.clients, ops.clients, ops.clientsDel);
  each(prev.users, next.users, ops.users, ops.usersDel);
  each(prev.systems, next.systems, ops.products, ops.productsDel);
  if (prev.settings !== next.settings) ops.settings.push({ key: 'settings', value: next.settings });
  if (prev.bankOverrides !== next.bankOverrides) ops.settings.push({ key: 'bankOverrides', value: next.bankOverrides || {} });
  const seen = new Set(prev.audit || []);
  ops.audit = (next.audit || []).filter((e) => !seen.has(e)).reverse();   // oldest first
  return ops;
}
export const isEmptyOps = (o) => Object.values(o).every((v) => v.length === 0);

const ok = async (q) => { const { error } = await q; if (error) throw new Error(error.message || 'Database error'); };

// Order matters: audit goes last, so a retry after a partial failure never duplicates audit rows.
export async function applyOps(db, ops) {
  if (ops.clients.length) await ok(db.from(T.clients).upsert(ops.clients.map(clientRow)));
  if (ops.users.length) await ok(db.from(T.users).upsert(ops.users.map(userRow)));
  if (ops.products.length) await ok(db.from(T.products).upsert(ops.products.map(productRow)));
  if (ops.productsDel.length) await ok(db.from(T.products).delete().in('id', ops.productsDel));
  if (ops.usersDel.length) await ok(db.from(T.users).delete().in('id', ops.usersDel));
  if (ops.clientsDel.length) await ok(db.from(T.clients).delete().in('id', ops.clientsDel));
  if (ops.settings.length) await ok(db.from(T.settings).upsert(ops.settings.map((s) => ({ ...s, updated_at: new Date().toISOString() }))));
  if (ops.audit.length) await ok(db.from(T.audit).insert(ops.audit.map(auditRow)));
}

export async function loadAll(db) {
  const get = async (q) => { const { data, error } = await q; if (error) throw new Error(error.message || 'Database error'); return data || []; };
  const [products, clients, users, audit, settings] = await Promise.all([
    get(db.from(T.products).select('data')),
    get(db.from(T.clients).select('*')),
    get(db.from(T.users).select('*')),
    get(db.from(T.audit).select('*').order('at', { ascending: false }).limit(AUDIT_LIMIT)),
    get(db.from(T.settings).select('*')),
  ]);
  const setting = (k) => settings.find((s) => s.key === k)?.value;
  const systems = products.map((r) => r.data).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return {
    empty: !products.length && !clients.length && !users.length,
    systems, clients: clients.map(clientFromRow), users: users.map(userFromRow), audit: audit.map(auditFromRow),
    settings: setting('settings'), bankOverrides: setting('bankOverrides'),
  };
}

// Wipe the v2_ tables and write a complete state (first run, and "Reset to demo data").
export async function resetAll(db, state) {
  await ok(db.from(T.products).delete().neq('id', ''));
  await ok(db.from(T.users).delete().neq('id', ''));
  await ok(db.from(T.clients).delete().neq('id', ''));
  await ok(db.from(T.settings).delete().neq('key', ''));
  await ok(db.from(T.audit).delete().gte('id', 0));
  const ops = diffState({ clients: [], users: [], systems: [], audit: [] }, state);
  ops.settings = [{ key: 'settings', value: state.settings }, { key: 'bankOverrides', value: state.bankOverrides || {} }];
  await applyOps(db, ops);
}
