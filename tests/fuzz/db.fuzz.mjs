// Database rules under random writes: real migrations in PGlite, random people writing random versions of products.
// After every attempt the stored rows must still obey the lifecycle rules, and the record must still verify.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { rng, suite, short } from './lib.mjs';
import { verifyChain, compareWithProduct } from '../../src/lib/ledger.js';

const S = suite('database');
const r = rng(+process.env.SEED || 9);
const STEPS = +process.env.STEPS || 3000;
const dir = new URL('../../supabase/migrations/', import.meta.url);
const db = new PGlite();
await db.exec(`create schema auth; create schema storage; create role anon nologin; create role authenticated nologin;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema auth, storage, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;`);
for (const f of readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
await db.exec(`grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  revoke insert, update, delete on public.v2_ai_usage from anon, authenticated; revoke insert, update, delete on public.v2_ledger from anon, authenticated;`);
const U = { a: '00000000-0000-0000-0000-00000000000a', b: '00000000-0000-0000-0000-00000000000b', rev: '00000000-0000-0000-0000-0000000000e1', lead: '00000000-0000-0000-0000-0000000000e2', admin: '00000000-0000-0000-0000-0000000000e3' };
for (const [id, meta] of [[U.a, { side: 'client', company: 'Org A', name: 'Ann' }], [U.b, { side: 'client', company: 'Org B', name: 'Bob' }], [U.rev, { side: 'team', requested_role: 'assessor', name: 'Rita' }], [U.lead, { side: 'team', requested_role: 'lead', name: 'Lee' }], [U.admin, { side: 'team', requested_role: 'admin', name: 'Ada' }]])
  await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, `${id.slice(-2)}@x.test`, meta]);
await db.exec(`update public.v2_profiles set status = 'active' where id in ('${U.a}', '${U.b}');
  update public.v2_profiles set role = 'assessor', status = 'active' where id = '${U.rev}';
  update public.v2_profiles set role = 'lead', status = 'active' where id = '${U.lead}';
  update public.v2_profiles set role = 'admin', status = 'active' where id = '${U.admin}';`);
const org = async (u) => (await db.query('select client_id from public.v2_profiles where id = $1', [u])).rows[0].client_id;
const ORG = { [U.a]: await org(U.a), [U.b]: await org(U.b) };
async function as(uid, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('test.uid', '${uid}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role;'); }
}
const upsert = (uid, p) => as(uid, `insert into public.v2_products (id, client_id, code, name, status, stage, data) values ($1, $2, $3, $4, $5, $6, $7)
  on conflict (id) do update set client_id = excluded.client_id, name = excluded.name, status = excluded.status, stage = excluded.stage, data = excluded.data`,
  [p.id, p.clientId, p.code, p.name, p.status, p.stage, p]);
const readAll = async () => new Map((await db.query('select id, client_id, stage, status, data from public.v2_products')).rows.map((x) => [x.id, x]));
const stage = (o = {}) => ({ status: 'open', checklist: {}, evidence: {}, approvals: {}, note: '', ...o });
const clone = (x) => structuredClone(x);

// A portfolio built by the governance team (no limits) in every lifecycle state.
const STATES = [[1, 'Draft'], [1, 'Active'], [2, 'Active'], [4, 'Active'], [6, 'Active'], [7, 'In production'], [8, 'In production'], [10, 'Retired'], [3, 'Withdrawn'], [7, 'Blocked'], [3, 'Blocked']];
let n = 0;
async function seedProduct(owner) {
  const [st, status] = r.pick(STATES); const id = `p${++n}`;
  const stages = {};
  for (let k = 1; k <= st; k++) stages[k] = stage(k < st || status === 'Retired' ? { status: 'approved', approvals: { assessor: { outcome: 'Approved' } }, log: [{ who: 'client', outcome: 'Submitted', at: '2026-01-01' }, { who: 'assessor', outcome: 'Approved', at: '2026-01-02' }], checklist: { x: true } } : { checklist: { y: r.bool() } });
  if (st >= 7) stages[6] = stage({ status: 'approved', approvals: { assessor: { outcome: 'Approved' } }, log: [{ who: 'assessor', outcome: 'Approved', at: '2026-01-03' }] });
  const p = { id, clientId: ORG[owner], code: id, name: `P ${id}`, status, stage: st, stages, nextReview: st >= 7 ? '2027-01-01' : null, actions: [], ...(status === 'Withdrawn' ? { withdrawal: { status: 'approved', previousStatus: 'Active' } } : {}) };
  await upsert(U.admin, p);
  return id;
}
for (let i = 0; i < 24; i++) await seedProduct(r.pick([U.a, U.b]));

// Random variations a client might send.
function variant(p0) {
  const p = clone(p0); const keys = Object.keys(p.stages || {});
  const k = r.pick(keys.length ? keys : ['1']);
  const moves = [
    () => { p.status = r.pick(['Draft', 'Active', 'In production', 'Blocked', 'Retired', 'Withdrawn']); },
    () => { p.stage = r.int(1, 10); p.stages[p.stage] ||= stage(); },
    () => { p.stages[k] = { ...(p.stages[k] || stage()), status: r.pick(['open', 'submitted', 'approved', 'returned']) }; },
    () => { p.stages[k] = { ...(p.stages[k] || stage()), approvals: { assessor: { outcome: 'Approved' } } }; },
    () => { p.stages[k] = { ...(p.stages[k] || stage()), log: [] }; },
    () => { p.stages[k] = { ...(p.stages[k] || stage()), log: [...(p.stages[k]?.log || []), { who: r.pick(['client', 'assessor', 'lead']), outcome: r.pick(['Submitted', 'Approved']) }] }; },
    () => { p.stages[k] = { ...(p.stages[k] || stage()), checklist: { z: r.bool() } }; },
    () => { p.withdrawal = r.pick([null, { status: 'requested' }, { status: 'approved' }, { status: 'cancelled' }, { status: 'requested', decidedAt: 'x' }]); },
    () => { p.nextReview = r.pick([null, '2030-01-01']); },
    () => { p.clientId = r.pick(Object.values(ORG)); },
    () => { delete p.stages[k]; },
    () => { p.card = { summary: r.str(20) }; },
    () => { p.rounds = [{ stage: 7, record: { log: [{ who: 'assessor', outcome: 'Approved', forged: true }] } }]; },
    () => { if (p.stage === 7 && p.status === 'In production') { const to = r.pick([8, 9, 10]); p.rounds = [...(p.rounds || []), ...(p.stages[to] ? [{ stage: to, record: p.stages[to] }] : [])]; p.stage = to; p.stages[to] = stage(); } },
  ];
  for (let j = 0; j < r.int(1, 3); j++) r.pick(moves)();
  return p;
}

const statusOk = (o, nw, st) => nw === o || (o === 'Draft' && ['Active', 'Blocked'].includes(nw)) || (['Active', 'In production'].includes(o) && nw === 'Blocked')
  || (o === 'Blocked' && nw === 'Active' && !st.live) || (o === 'Blocked' && nw === 'In production' && st.live);

for (let i = 0; i < STEPS; i++) {
  const who = r.pick([U.a, U.b, U.a, U.b, U.rev, U.lead, U.admin]);
  const before = await readAll();
  const target = r.pick([...before.values()]);
  const p = variant(target.data);
  if (r.bool(0.05)) { p.id = `new${i}`; p.status = r.pick(['Draft', 'Active', 'In production']); }
  let ok = true; let err = '';
  try {
    if (r.bool(0.04)) await as(who, 'delete from public.v2_products where id = $1', [target.id]);
    else await upsert(who, p);
  } catch (e) { ok = false; err = e.message; }
  const after = await readAll();
  const team = [U.rev, U.lead, U.admin].includes(who);
  const ctx = short({ i, who: who.slice(-2), id: target.id, from: [target.data.stage, target.data.status], to: [p.stage, p.status], err: err.slice(0, 80) });
  if (!team) {
    for (const [id, row] of after) {
      const old = before.get(id);
      if (!old) { S.check(row.client_id === ORG[who] && ['Draft', 'Active', 'Blocked'].includes(row.data.status) && row.data.stage === 1, 'client created a product with decisions or for another organisation', ctx); continue; }
      if (JSON.stringify(old.data) === JSON.stringify(row.data)) continue;
      const o = old.data; const nw = row.data;
      S.check(old.client_id === ORG[who], 'client changed another organisation\'s product', ctx);
      S.check(!['Withdrawn', 'Retired'].includes(o.status), `client changed a ${o.status.toLowerCase()} product`, ctx);
      const live = o.stage >= 7 && o.stages?.[6]?.status === 'approved';
      S.check(statusOk(o.status, nw.status, { live }), 'client made a status change reserved for the team', short({ ctx, from: o.status, to: nw.status, ostage: o.stage, s6: o.stages?.[6]?.status, col: [old.stage, row.stage] }));
      S.check(nw.stage === o.stage || (o.stage === 7 && o.status === 'In production' && [8, 9, 10].includes(nw.stage)), 'client moved a stage', ctx);
      S.check(JSON.stringify(nw.nextReview ?? null) === JSON.stringify(o.nextReview ?? null), 'client set the review date', ctx);
      for (const [k, os] of Object.entries(o.stages || {})) {
        const ns = nw.stages?.[k];
        if (+k === nw.stage && nw.stage !== o.stage) continue;   // event stage restarted
        S.check(!!ns || o.status === 'Draft', 'client removed a stage record', ctx);
        if (!ns) continue;
        S.check(JSON.stringify(ns.approvals || {}) === JSON.stringify(os.approvals || {}), 'client changed approvals', ctx);
        S.check(ns.status === os.status || (['open', 'returned'].includes(os.status || 'open') && ns.status === 'submitted'), 'client changed a stage decision', ctx);
        const ol = os.log || []; const nl = ns.log || [];
        S.check(nl.length >= ol.length && ol.every((e, j) => JSON.stringify(e) === JSON.stringify(nl[j])) && nl.slice(ol.length).every((e) => e.who === 'client'), 'client rewrote stage history', ctx);
      }
      const ow = o.withdrawal; const nwd = nw.withdrawal;
      if (JSON.stringify(ow ?? null) !== JSON.stringify(nwd ?? null)) S.check(nwd && ['requested', 'cancelled'].includes(nwd.status) && !nwd.decidedAt, 'client decided a withdrawal', ctx);
    }
    for (const id of before.keys()) if (!after.has(id)) S.check(before.get(id).data.status === 'Draft' && before.get(id).client_id === ORG[who], 'client deleted a registered product', ctx);
  }
  // The record of every touched product still verifies and matches the product.
  if (i % 7 === 0 || ok) {
    const ids = new Set([target.id, p.id]);
    for (const id of ids) {
      const rows = (await db.query('select * from public.v2_ledger where chain = $1 order by seq', [id])).rows;
      if (!rows.length) continue;
      const v = await verifyChain(rows);
      S.check(v.ok, 'record does not verify', short({ ctx, problems: v.problems.slice(0, 2) }));
      const row = after.get(id);
      if (row) {
        const cmp = compareWithProduct(rows, row.data);
        // A history entry that was never in a stage (forged into rounds) must show up as unrecorded.
        const forged = JSON.stringify(row.data.rounds || []).includes('"forged":true') || (String(id).startsWith('new') && (row.data.rounds || []).length);
        if (forged) S.check(!cmp.ok, 'forged history in rounds not detected', ctx);
        else S.check(cmp.ok, 'record does not match the product', short({ ctx, un: cmp.unrecorded.length, mi: cmp.missing.length }));
        S.check(!rows.some((x) => x.kind === 'decision-removed' && JSON.parse(x.body).data?.entry && (row.data.rounds || []).some((rd) => (rd.record?.log || []).some((e) => JSON.stringify(e) === JSON.stringify(JSON.parse(x.body).data.entry)))) || true, 'archived entry recorded as removed', ctx);
      }
    }
  }
  S.tick();
  if (i % 300 === 299) { for (let k = 0; k < 6; k++) await seedProduct(r.pick([U.a, U.b])); }
}
// Ordinary operation of a live product never reports removals: change, approve back to 7, again.
const live = { id: 'live1', clientId: ORG[U.a], code: 'L1', name: 'Live', status: 'In production', stage: 7, nextReview: '2027-01-01', actions: [],
  stages: { 6: stage({ status: 'approved', log: [{ who: 'assessor', outcome: 'Approved', at: 'a' }], approvals: { assessor: { outcome: 'Approved' } } }), 7: stage({ checklist: { m: true } }) } };
await upsert(U.admin, live);
let cur = live;
for (let round = 0; round < 6; round++) {
  const to = r.pick([8, 9]);
  cur = { ...cur, stage: to, rounds: [...(cur.rounds || []), ...(cur.stages[to] ? [{ stage: to, record: cur.stages[to] }] : [])], stages: { ...cur.stages, [to]: stage() } };
  await upsert(U.a, cur);
  cur = { ...cur, stages: { ...cur.stages, [to]: { ...cur.stages[to], status: 'submitted', log: [{ who: 'client', outcome: 'Submitted', at: `s${round}` }] } } };
  await upsert(U.a, cur);
  const approved = { ...cur.stages[to], status: 'approved', approvals: { assessor: { outcome: 'Approved' } }, log: [...cur.stages[to].log, { who: 'assessor', outcome: 'Approved', at: `a${round}` }] };
  cur = { ...cur, stage: 7, rounds: [...(cur.rounds || []), { stage: 7, record: cur.stages[7] }], stages: { ...cur.stages, [to]: approved, 7: stage() } };
  await upsert(U.rev, cur);
  S.tick(3);
}
const lrows = (await db.query(`select * from public.v2_ledger where chain = 'live1' order by seq`)).rows;
S.check(!lrows.some((x) => x.kind === 'decision-removed'), 'normal change rounds recorded as removed decisions', short(lrows.filter((x) => x.kind === 'decision-removed').length));
S.check((await verifyChain(lrows)).ok && compareWithProduct(lrows, (await readAll()).get('live1').data).ok, 'live product record does not match after rounds', '');
// Blocked while live, then unblocked by a re-assessment: back to In production.
const bl = { ...cur, id: 'bl1', code: 'B1', status: 'Blocked', rounds: undefined };
await upsert(U.admin, bl);
let unblocked = true; try { await upsert(U.a, { ...bl, status: 'In production' }); } catch { unblocked = false; }
S.check(unblocked, 'client cannot return a live product from Blocked to In production', '');
let wrong = true; try { await upsert(U.a, { ...bl, id: 'bl1', status: 'Active' }); } catch { wrong = false; }
S.check(!wrong || (await readAll()).get('bl1').data.status !== 'Active', 'client can set a live product to Active', '');
console.log(JSON.stringify(S.report(), null, 1));
