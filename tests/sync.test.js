import test from 'node:test';
import assert from 'node:assert/strict';
import { diffState, isEmptyOps, applyOps, loadAll, resetDemo, productRow } from '../src/store/sync.js';
import { buildSeed } from '../src/store/seed.js';

// Minimal Supabase-style client over plain arrays.
function fakeDb({ failOn = null } = {}) {
  const t = { v2_products: [], v2_clients: [], v2_users: [], v2_audit: [], v2_settings: [], v2_profiles: [], v2_notes: [] }; let id = 1; const keys = { v2_products: 'id', v2_clients: 'id', v2_users: 'id', v2_settings: 'key', v2_notes: 'id', v2_profiles: 'id' };
  const db = {
    t, failOn,
    from(name) {
      const f = []; let op = 'select'; let payload; let ord = null; let lim = null;
      const q = {
        select() { op = 'select'; return q; }, order(c, o) { ord = [c, o.ascending]; return q; }, limit(n) { lim = n; return q; },
        upsert(r) { op = 'upsert'; payload = r; return q; }, insert(r) { op = 'insert'; payload = r; return q; }, delete() { op = 'delete'; return q; },
        in(c, v) { f.push((r) => v.includes(r[c])); return q; }, neq(c, v) { f.push((r) => r[c] !== v); return q; }, gte(c, v) { f.push((r) => r[c] >= v); return q; },
        then(res, rej) {
          return Promise.resolve().then(() => {
            if (db.failOn && db.failOn === `${op}:${name}`) { db.failOn = null; return { data: null, error: { message: `injected ${op} failure` } }; }
            const rows = t[name];
            if (op === 'select') { let o = rows.filter((r) => f.every((x) => x(r))); if (ord) o = [...o].sort((a, b) => String(a[ord[0]]).localeCompare(String(b[ord[0]])) * (ord[1] ? 1 : -1)); if (lim) o = o.slice(0, lim); return { data: o, error: null }; }
            if (op === 'upsert') { for (const r of payload) { const i = rows.findIndex((x) => x[keys[name]] === r[keys[name]]); if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ ...r }); } return { error: null }; }
            if (op === 'insert') { for (const r of payload) rows.push({ id: id++, ...r }); return { error: null }; }
            t[name] = rows.filter((r) => !f.every((x) => x(r))); return { error: null };
          }).then(res, rej);
        },
      };
      return q;
    },
  };
  return db;
}
const state = () => ({ ...buildSeed(), settings: { aiQuestions: true, enabledFrameworks: ['EU_AI_ACT'], cutoffs: {} }, bankOverrides: {} });

test('no change means nothing to save', () => {
  const s = state(); assert.ok(isEmptyOps(diffState(s, { ...s })));
});

test('only the changed product is saved, and new audit rows go in oldest first', () => {
  const a = state();
  const changed = { ...a.systems[2], stage: 5 };
  const entry1 = { at: '2026-11-02T10:00:00Z', actor: 'client', action: 'One' }; const entry2 = { at: '2026-11-02T10:01:00Z', actor: 'client', action: 'Two' };
  const b = { ...a, systems: a.systems.map((x, i) => (i === 2 ? changed : x)), audit: [entry2, entry1, ...a.audit] };
  const ops = diffState(a, b);
  assert.deepEqual(ops.products.map((p) => p.id), [changed.id]);
  assert.deepEqual(ops.audit.map((e) => e.action), ['One', 'Two']);
  assert.equal(ops.productsDel.length + ops.clients.length + ops.users.length + ops.settings.length, 0);
});

test('deleted drafts, added clients and changed settings are detected', () => {
  const a = state();
  const b = { ...a, systems: a.systems.slice(1), clients: [...a.clients, { id: 'c9', name: 'Acme' }], settings: { ...a.settings, aiQuestions: false }, bankOverrides: { 'GD-C1': { q: 'x' } } };
  const ops = diffState(a, b);
  assert.deepEqual(ops.productsDel, [a.systems[0].id]); assert.deepEqual(ops.clients.map((c) => c.id), ['c9']);
  assert.deepEqual(ops.settings.map((s) => s.key).sort(), ['bankOverrides', 'settings']);
});

test('save then load gives back the same data', async () => {
  const db = fakeDb(); const s = state();
  await resetDemo(db, s);
  const r = await loadAll(db);
  assert.equal(r.empty, false);
  assert.equal(r.systems.length, s.systems.length); assert.equal(r.clients.length, 3); assert.equal(r.users.length, 0, 'people come from sign-ups, not the demo list');
  assert.equal(r.notes.length, s.notes.length);
  assert.deepEqual(r.systems.map((x) => x.id).sort(), s.systems.map((x) => x.id).sort());
  assert.deepEqual(r.settings, s.settings);
  assert.equal(r.audit.length, s.audit.length);
  assert.ok(r.audit[0].at >= r.audit[r.audit.length - 1].at, 'newest first');
  assert.equal(JSON.stringify(r.systems.find((x) => x.id === 'sys-1')), JSON.stringify(s.systems.find((x) => x.id === 'sys-1')));
});

test('an empty database is reported as empty', async () => { assert.equal((await loadAll(fakeDb())).empty, true); });

test('product rows carry the columns the database indexes', () => {
  const s = state().systems[0]; const r = productRow(s);
  assert.equal(r.client_id, s.clientId); assert.equal(r.stage, s.stage); assert.equal(r.data, s);
});

test('a failed save can be retried without duplicating audit rows', async () => {
  const db = fakeDb(); const a = state(); await resetDemo(db, a);
  const auditBefore = db.t.v2_audit.length;
  const e = { at: '2026-11-02T11:00:00Z', actor: 'lead', action: 'Approved', target: 'sys-1', detail: '' };
  const b = { ...a, systems: a.systems.map((x, i) => (i === 0 ? { ...x, stage: 3 } : x)), audit: [e, ...a.audit] };
  db.failOn = 'insert:v2_audit';
  await assert.rejects(() => applyOps(db, diffState(a, b)), /injected/);
  assert.equal(db.t.v2_audit.length, auditBefore);
  assert.equal(db.t.v2_products.find((p) => p.id === a.systems[0].id).stage, 3, 'product saved before audit');
  await applyOps(db, diffState(a, b));
  assert.equal(db.t.v2_audit.length, auditBefore + 1);
  await applyOps(db, diffState(b, b));
  assert.equal(db.t.v2_audit.length, auditBefore + 1);
});

test('demo reset rewrites demo organisations only and keeps people who signed up', async () => {
  const db = fakeDb(); const a = state(); await resetDemo(db, a);
  db.t.v2_products.push({ id: 'sys-old', client_id: 'northwind', data: {} });
  db.t.v2_clients.push({ id: 'cli-real', name: 'Real Co' }); db.t.v2_products.push({ id: 'sys-real', client_id: 'cli-real', data: { id: 'sys-real' } });
  await resetDemo(db, a);
  assert.ok(!db.t.v2_products.some((p) => p.id === 'sys-old'), 'stale demo product removed');
  assert.ok(db.t.v2_products.some((p) => p.id === 'sys-real') && db.t.v2_clients.some((c) => c.id === 'cli-real'), 'real organisation kept');
});

test('internal notes are saved to their own table, never inside the product', () => {
  const a = state();
  assert.ok(a.notes.length > 0, 'seed has an internal note');
  assert.ok(!JSON.stringify(a.systems).includes(a.notes[0].text), 'note text not in product data');
  const note = { id: 'note-x', productId: 'sys-1', stage: 4, at: '2026-11-03T10:00:00Z', byRole: 'assessor', text: 'team only' };
  const ops = diffState(a, { ...a, notes: [...a.notes, note] });
  assert.deepEqual(ops.notes.map((n) => n.id), ['note-x']);
  assert.equal(ops.products.length, 0);
});

test('signed-in mode never writes people from the browser', () => {
  const a = state();
  const ops = diffState(a, { ...a, users: [...a.users, { id: 'u9', name: 'X', email: 'x@y.z', role: 'admin' }] }, { users: false });
  assert.equal(ops.users.length, 0);
});
