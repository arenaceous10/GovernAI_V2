// Runs the real migrations in an in-process Postgres (PGlite) with stand-ins for Supabase's auth and storage
// schemas, then checks the access rules as each kind of user. Usage: node --test tests/db/rls.test.mjs
// Run with: npm run test:db
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MIG = (f) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8');
const PRELUDE = `
create schema auth; create schema storage;
create role anon nologin; create role authenticated nologin;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema auth, storage, public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
`;
const U = { a: '00000000-0000-0000-0000-00000000000a', b: '00000000-0000-0000-0000-00000000000b', rev: '00000000-0000-0000-0000-0000000000e1', lead: '00000000-0000-0000-0000-0000000000e2', admin: '00000000-0000-0000-0000-0000000000e3', pend: '00000000-0000-0000-0000-0000000000f1' };

async function setup() {
  const db = new PGlite();
  await db.exec(PRELUDE);
  for (const f of ['001_governai_v2.sql', '002_evidence_files.sql', '003_auth_rbac.sql', '004_ai_usage.sql', '005_security_fixes.sql', '006_function_privileges.sql', '007_ledger_and_ops.sql', '008_withdrawal_guard.sql', '009_test_sweep_fixes.sql', '010_product_versions.sql', '011_operations.sql']) await db.exec(MIG(f));
  await db.exec(`grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    revoke insert, update, delete on public.v2_ai_usage from anon, authenticated;
    revoke insert, update, delete on public.v2_ledger from anon, authenticated;`);
  const signup = (id, email, meta) => db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, meta]);
  await signup(U.a, 'a@a.test', { side: 'client', company: 'Org A', name: 'Ann A' });
  await signup(U.b, 'b@b.test', { side: 'client', company: 'Org B', name: 'Bob B' });
  await signup(U.rev, 'r@gov.test', { side: 'team', requested_role: 'assessor', name: 'Rita Reviewer' });
  await signup(U.lead, 'l@gov.test', { side: 'team', requested_role: 'lead', name: 'Lee Lead' });
  await signup(U.admin, 'ad@gov.test', { side: 'team', requested_role: 'admin', name: 'Ada Admin' });
  await signup(U.pend, 'p@a.test', { side: 'client', company: 'org a', name: 'Pat Pending' });
  await db.exec(`update public.v2_profiles set status = 'active' where id in ('${U.a}', '${U.b}');
                 update public.v2_profiles set role = 'assessor', status = 'active' where id = '${U.rev}';
                 update public.v2_profiles set role = 'lead', status = 'active' where id = '${U.lead}';
                 update public.v2_profiles set role = 'admin', status = 'active' where id = '${U.admin}';`);
  const org = async (u) => (await db.query('select client_id from public.v2_profiles where id = $1', [u])).rows[0].client_id;
  return { db, orgA: await org(U.a), orgB: await org(U.b) };
}

// Run SQL as a signed-in user (non-superuser role, so row-level security applies).
async function as(db, uid, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('test.uid', '${uid}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role;'); }
}
const fails = async (p, re) => { await assert.rejects(p, re); };

const stage = (o = {}) => ({ status: 'open', checklist: {}, evidence: {}, approvals: {}, note: '', ...o });
const product = (id, clientId, o = {}) => ({ id, clientId, code: id, name: `Product ${id}`, status: 'Draft', stage: 1, stages: { 1: stage() }, nextReview: null, actions: [], ...o });
const upsert = (db, uid, p) => as(db, uid,
  `insert into public.v2_products (id, client_id, code, name, status, stage, data) values ($1, $2, $3, $4, $5, $6, $7)
   on conflict (id) do update set client_id = excluded.client_id, name = excluded.name, status = excluded.status, stage = excluded.stage, data = excluded.data`,
  [p.id, p.clientId, p.code, p.name, p.status, p.stage, p]);
const read = async (db, id) => (await db.query('select data from public.v2_products where id = $1', [id])).rows[0]?.data;

test('every new account waits for an administrator, including the first user of a new organisation', async () => {
  const { db } = await setup();
  const r = (await db.query(`select id, role, status, client_id from public.v2_profiles order by email`)).rows;
  for (const u of [U.pend]) assert.equal(r.find((x) => x.id === u).status, 'pending');
  assert.equal(r.find((x) => x.id === U.pend).client_id, r.find((x) => x.id === U.a).client_id, 'joins the existing organisation by name');
  const fresh = '00000000-0000-0000-0000-0000000000f2';
  await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [fresh, 'n@new.test', { side: 'client', company: 'Brand New Ltd' }]);
  const p = (await db.query('select status, role, client_id from public.v2_profiles where id = $1', [fresh])).rows[0];
  assert.equal(p.status, 'pending'); assert.equal(p.role, 'client'); assert.ok(p.client_id);
  assert.equal((await as(db, fresh, 'select public.ai_usage_take() as v')).rows[0].v, 'forbidden', 'pending users get no AI calls');
  assert.equal((await as(db, fresh, 'select count(*)::int as n from public.v2_products')).rows[0].n, 0);
});

test('evidence files: each client reaches only its own; the id = name trick no longer opens everything', async () => {
  const { db, orgA, orgB } = await setup();
  await upsert(db, U.a, product('pa', orgA, { name: 'Claims model' }));
  await upsert(db, U.b, product('pb', orgB, { name: 'Pricing model' }));
  await db.exec(`insert into storage.objects (bucket_id, name) values ('v2-evidence', 'pa/stage-1/a.pdf'), ('v2-evidence', 'pb/stage-1/b.pdf')`);
  const seen = async (u) => (await as(db, u, `select name from storage.objects where bucket_id = 'v2-evidence' order by name`)).rows.map((x) => x.name);
  assert.deepEqual(await seen(U.a), ['pa/stage-1/a.pdf'], 'client A sees its own file (was blocked before the fix)');
  assert.deepEqual(await seen(U.b), ['pb/stage-1/b.pdf']);
  assert.equal((await seen(U.rev)).length, 2, 'the governance team sees all');
  // attack: a product whose id equals its name
  await upsert(db, U.a, product('x', orgA, { name: 'x', code: 'x' }));
  assert.deepEqual(await seen(U.a), ['pa/stage-1/a.pdf'], 'still only its own files');
  await as(db, U.a, `delete from storage.objects where name = 'pb/stage-1/b.pdf'`);
  assert.equal((await db.query(`select count(*)::int as n from storage.objects where name = 'pb/stage-1/b.pdf'`)).rows[0].n, 1, 'cannot delete another org\'s file');
  await fails(as(db, U.a, `insert into storage.objects (bucket_id, name) values ('v2-evidence', 'pb/stage-1/planted.pdf')`), /row-level security/);
  await as(db, U.a, `insert into storage.objects (bucket_id, name) values ('v2-evidence', 'pa/stage-2/new.pdf')`);
});

test('a client can do its own lifecycle work but cannot approve, skip stages, go live or delete a live product', async () => {
  const { db, orgA } = await setup();
  let p = product('p1', orgA);
  await upsert(db, U.a, p);                                                                   // draft
  p = { ...p, status: 'Active', stages: { 1: stage({ checklist: { a: true } }) } };
  await upsert(db, U.a, p);                                                                   // register
  p = { ...p, stages: { 1: { ...p.stages[1], checklist: { a: true, b: true }, skipped: { c: { reason: 'Covered by the group policy review.' } } } }, card: { summary: 'x' }, actions: [{ id: 'a1', status: 'Open' }] };
  await upsert(db, U.a, p);                                                                   // tick, skip, card, actions
  p = { ...p, stages: { 1: { ...p.stages[1], status: 'submitted', approvals: {}, log: [{ who: 'client', outcome: 'Submitted' }] } } };
  await upsert(db, U.a, p);                                                                   // submit

  // forbidden client changes on a submitted stage
  await fails(upsert(db, U.a, { ...p, stages: { 1: { ...p.stages[1], checklist: { a: true } } } }), /under review or decided/);
  await fails(upsert(db, U.a, { ...p, stages: { 1: { ...p.stages[1], status: 'approved' } } }), /governance team/);
  await fails(upsert(db, U.a, { ...p, stages: { 1: { ...p.stages[1], approvals: { assessor: { outcome: 'Approved' } } } } }), /approvals/);
  await fails(upsert(db, U.a, { ...p, stage: 2, stages: { ...p.stages, 2: stage() } }), /moves a product between stages/);
  await fails(upsert(db, U.a, { ...p, status: 'In production' }), /governance team/);
  await fails(upsert(db, U.a, { ...p, nextReview: '2030-01-01' }), /review date/);
  await fails(upsert(db, U.a, { ...p, stages: { 1: { ...p.stages[1], log: [...p.stages[1].log, { who: 'lead', outcome: 'Approved' }] } } }), /under review or decided|history/);

  // the reviewer approves: stage 2 opens
  const approved = { ...p, stage: 2, stages: { 1: { ...p.stages[1], status: 'approved', approvals: { assessor: { outcome: 'Approved' } } }, 2: stage() } };
  await upsert(db, U.rev, approved);
  // a stale client copy (stage 1 still submitted) cannot overwrite the approval
  await fails(upsert(db, U.a, { ...p, card: { summary: 'edited offline' } }), /42501|governance team|moves a product/);
  assert.equal((await read(db, 'p1')).stages[1].status, 'approved');
  // client works on stage 2, cannot touch stage 1's decision
  const w = { ...approved, stages: { ...approved.stages, 2: stage({ checklist: { z: true } }) } };
  await upsert(db, U.a, w);
  await fails(upsert(db, U.a, { ...w, stages: { ...w.stages, 1: { ...w.stages[1], conditions: 'none' } } }), /under review or decided/);
  await fails(upsert(db, U.a, { ...w, stages: { ...w.stages, 1: { ...w.stages[1], evidence: { swapped: { file: 'other.pdf' } } } } }), /under review or decided/);
  // returned by the reviewer, the client re-submits (approvals cleared by the app)
  const ret = { ...w, stages: { ...w.stages, 2: { ...w.stages[2], status: 'returned', approvals: { assessor: { outcome: 'Returned' } }, log: [{ who: 'assessor', outcome: 'Returned' }] } } };
  await upsert(db, U.rev, ret);
  await upsert(db, U.a, { ...ret, stages: { ...ret.stages, 2: { ...ret.stages[2], status: 'submitted', approvals: {}, log: [...ret.stages[2].log, { who: 'client', outcome: 'Submitted' }] } } });
  // the Draft trick
  await fails(upsert(db, U.a, { ...ret, status: 'Draft' }), /governance team/);
  await as(db, U.a, `delete from public.v2_products where id = 'p1'`);
  assert.ok(await read(db, 'p1'), 'a registered product cannot be deleted by the client');
});

test('a client may raise a change or incident on a live product, again and again', async () => {
  const { db, orgA } = await setup();
  const live = product('p7', orgA, { status: 'In production', stage: 7, stages: { 6: stage({ status: 'approved', approvals: { lead: { outcome: 'Approved' } } }), 7: stage(), 8: stage({ status: 'approved', approvals: { assessor: { outcome: 'Approved' } }, log: [{ who: 'assessor', outcome: 'Approved' }] }) } });
  await upsert(db, U.lead, live);
  await upsert(db, U.a, { ...live, stage: 8, stages: { ...live.stages, 8: stage() }, events: [{ kind: 'change' }] });
  assert.equal((await read(db, 'p7')).stage, 8);
  await fails(upsert(db, U.a, { ...(await read(db, 'p7')), stage: 6 }), /moves a product/);
});

test('a client cannot create a product that already carries decisions', async () => {
  const { db, orgA } = await setup();
  await fails(upsert(db, U.a, product('p2', orgA, { status: 'In production', stage: 7 })), /stage 1/);
  await fails(upsert(db, U.a, product('p3', orgA, { status: 'Active', stages: { 1: stage({ status: 'approved' }) } })), /decisions/);
  await fails(upsert(db, U.a, product('p4', orgA, { status: 'Active', stages: { 1: stage({ approvals: { lead: { outcome: 'Approved' } } }) } })), /decisions/);
});

test('audit entries written by a client carry the real actor, organisation and time', async () => {
  const { db, orgA } = await setup();
  await as(db, U.a, `insert into public.v2_audit (at, actor, actor_name, org, action, target, detail) values ('2020-01-01', 'lead', 'Lee Lead', null, 'Stage approved', 'p1', 'forged')`);
  const r = (await db.query(`select actor, actor_name, org, at from public.v2_audit where detail = 'forged'`)).rows[0];
  assert.equal(r.actor, 'client'); assert.equal(r.actor_name, 'Ann A'); assert.equal(r.org, orgA);
  assert.ok(new Date(r.at).getFullYear() >= 2026);
  // the team's own entries are kept as written (e.g. demo seeding)
  await as(db, U.rev, `insert into public.v2_audit (at, actor, org, action, detail) values ('2026-01-02', 'assessor', null, 'Seeded', 'team')`);
  assert.equal((await db.query(`select actor from public.v2_audit where detail = 'team'`)).rows[0].actor, 'assessor');
});

test('AI usage: one locked check-and-record per call, per-user limit, no direct writes', async () => {
  const { db } = await setup();
  const take = async (u) => (await as(db, u, 'select public.ai_usage_take() as v')).rows[0].v;
  const got = []; for (let i = 0; i < 14; i++) got.push(await take(U.a));
  assert.equal(got.filter((v) => v === 'ok').length, 12); assert.equal(got.at(-1), 'hour');
  assert.equal(await take(U.rev), 'forbidden', 'reviewers cannot generate questions');
  assert.equal(await take(U.pend), 'forbidden', 'pending users cannot');
  await fails(as(db, U.b, `insert into public.v2_ai_usage (user_id) values ('${U.b}')`), /permission denied/);
  await fails(as(db, U.a, `delete from public.v2_ai_usage`), /permission denied/);
  // a client asking for a higher limit gets the built-in ceiling
  assert.equal((await as(db, U.a, 'select public.ai_usage_take(999, 999, 999) as v')).rows[0].v, 'hour');
});

test('a product row cannot pose as another organisation\'s product', async () => {
  const { db, orgA, orgB } = await setup();
  await upsert(db, U.b, product('victim', orgB));
  // a client row whose data claims to be org B's product
  await fails(as(db, U.a, `insert into public.v2_products (id, client_id, status, stage, data) values ('mine', $1, 'Draft', 1, $2)`,
    [orgA, product('victim', orgB)]), /does not match/);
  // nor can anyone, team included, make data and record disagree
  await fails(as(db, U.rev, `update public.v2_products set data = jsonb_set(data, '{clientId}', to_jsonb($1::text)) where id = 'victim'`, [orgA]), /does not match/);
});

// ---------- tamper-evident record (migration 007) ----------
import { verifyChain, compareWithProduct, entries } from '../../src/lib/ledger.js';
const ledger = async (db, id, uid) => (uid ? await as(db, uid, 'select * from public.v2_ledger where chain = $1 order by seq', [id])
  : await db.query('select * from public.v2_ledger where chain = $1 order by seq', [id])).rows;

test('the database keeps a hash-chained record of each product that the browser can verify', async () => {
  const { db, orgA } = await setup();
  const p = product('pl', orgA, { evidenceNote: 1 });
  await upsert(db, U.a, p);
  const submitted = { ...p, status: 'Active', stages: { 1: stage({ status: 'submitted', checklist: { 'Owner named': true, 'Draft only': false },
    evidence: { 'Owner named': { name: 'owner.pdf', size: 120, data: 'data:application/pdf;base64,AAAA' } },
    log: [{ at: '2026-11-06T10:00:00Z', who: 'client', outcome: 'Submitted', comment: 'ready' }] }) } };
  await upsert(db, U.a, submitted);
  const approved = { ...submitted, stage: 2, stages: { 1: { ...submitted.stages[1], status: 'approved', approvals: { assessor: { outcome: 'Approved', comment: 'ok', at: 'x' } },
    log: [...submitted.stages[1].log, { at: '2026-11-06T11:00:00Z', who: 'assessor', as: 'assessor', outcome: 'Approved', comment: 'ok' }] }, 2: stage() } };
  await upsert(db, U.rev, approved);
  await as(db, U.rev, `insert into public.v2_audit (at, actor, actor_name, action, target, detail) values (now(), 'assessor', 'Rita Reviewer', 'Stage approved', 'pl', 'Stage 1: ok')`);

  const rows = await ledger(db, 'pl', U.a);
  const kinds = entries(rows).map((e) => e.kind);
  assert.deepEqual(kinds, ['registered', 'status', 'decision', 'stage', 'decision', 'audit']);
  const sub = entries(rows)[2];
  assert.equal(sub.actor, 'client'); assert.equal(sub.data.entry.outcome, 'Submitted');
  assert.deepEqual(sub.data.submitted.checklist, { 'Owner named': true }, 'only ticked checks are fingerprinted');
  assert.equal(sub.data.submitted.evidence['Owner named'].name, 'owner.pdf');
  assert.equal(sub.data.submitted.evidence['Owner named'].data, undefined, 'file contents stay out of the record');
  assert.equal(entries(rows)[4].actor, 'assessor');
  assert.equal(entries(rows)[5].data.by, 'Rita Reviewer');
  const v = await verifyChain(rows);
  assert.ok(v.ok, JSON.stringify(v.problems)); assert.equal(v.count, 6);
  assert.ok(compareWithProduct(rows, await read(db, 'pl')).ok);
});

test('nobody can write the record through the API, and each client sees only its own', async () => {
  const { db, orgA, orgB } = await setup();
  await upsert(db, U.a, product('pa', orgA)); await upsert(db, U.b, product('pb', orgB));
  for (const u of [U.a, U.rev, U.lead]) {
    await fails(as(db, u, `insert into public.v2_ledger (chain, seq, kind, body, prev, hash) values ('pa', 9, 'x', '{}', '', '')`), /permission denied/);
    await fails(as(db, u, `update public.v2_ledger set body = '{}' where chain = 'pa'`), /permission denied/);
    await fails(as(db, u, `delete from public.v2_ledger where chain = 'pa'`), /permission denied/);
    await fails(as(db, u, `select public.gov_ledger_append('pa', null, 'x', '{}')`), /permission denied/);
  }
  assert.deepEqual((await as(db, U.a, 'select distinct chain from public.v2_ledger')).rows.map((r) => r.chain), ['pa']);
  assert.equal((await as(db, U.rev, 'select count(distinct chain)::int as n from public.v2_ledger')).rows[0].n, 2);
});

test('edits show: a rewritten log entry is recorded, and direct changes to the record break the chain', async () => {
  const { db, orgA } = await setup();
  const p = product('pt', orgA);
  await upsert(db, U.a, p);
  const sub = { ...p, status: 'Active', stages: { 1: stage({ status: 'submitted', log: [{ at: '2026-11-06T10:00:00Z', who: 'client', outcome: 'Submitted', comment: 'v1' }] }) } };
  await upsert(db, U.a, sub);
  // the team rewrites the client's comment in the product JSON
  await upsert(db, U.lead, { ...sub, stages: { 1: { ...sub.stages[1], log: [{ ...sub.stages[1].log[0], comment: 'edited' }] } } });
  let rows = await ledger(db, 'pt');
  const last2 = entries(rows).slice(-2).map((e) => e.kind);
  assert.deepEqual(last2, ['decision', 'decision-removed']);
  assert.equal(entries(rows).at(-1).actor, 'lead', 'the record says who edited it');
  assert.ok((await verifyChain(rows)).ok);
  const cmp = compareWithProduct(rows, await read(db, 'pt'));
  assert.ok(cmp.ok); assert.equal(cmp.removed.length, 1);

  // someone with database access edits the record itself
  await db.exec(`update public.v2_ledger set body = replace(body, 'v1', 'v0') where chain = 'pt' and seq = 3`);
  rows = await ledger(db, 'pt');
  let v = await verifyChain(rows);
  assert.equal(v.ok, false); assert.equal(v.problems[0].seq, 3);
  // ... or recomputes that hash too: the next entry no longer links
  await db.exec(`update public.v2_ledger set hash = encode(sha256(convert_to(prev || E'\\n' || body, 'UTF8')), 'hex') where chain = 'pt' and seq = 3`);
  v = await verifyChain(await ledger(db, 'pt'));
  assert.equal(v.ok, false); assert.match(v.problems[0].what, /link/);
  // ... or deletes an entry
  await db.exec(`delete from public.v2_ledger where chain = 'pt' and seq = 2`);
  v = await verifyChain(await ledger(db, 'pt'));
  assert.equal(v.ok, false); assert.match(v.problems[0].what, /missing/);
});

test('deleting a product is recorded and its record is kept', async () => {
  const { db, orgA } = await setup();
  await upsert(db, U.a, product('pd', orgA));
  await as(db, U.a, `delete from public.v2_products where id = 'pd'`);
  const rows = await ledger(db, 'pd', U.a);
  assert.deepEqual(entries(rows).map((e) => e.kind), ['registered', 'deleted']);
});

// ---------- withdrawal (migration 008) ----------
test('clients ask to withdraw; only the governance team decides, and a withdrawn product is frozen for clients', async () => {
  const { db, orgA } = await setup();
  const p = { ...product('pw', orgA), status: 'Active' };
  await upsert(db, U.a, product('pw', orgA)); await upsert(db, U.a, p);
  const req = { ...p, withdrawal: { status: 'requested', at: 'x', category: 'Project cancelled', reason: 'Budget cut' } };
  await upsert(db, U.a, req);
  await fails(upsert(db, U.a, { ...req, withdrawal: { ...req.withdrawal, status: 'approved', decidedAt: 'x' } }), /governance team can decide/);
  await fails(upsert(db, U.a, { ...req, status: 'Withdrawn' }), /./, 'client cannot set the status');
  await upsert(db, U.a, { ...req, withdrawal: { ...req.withdrawal, status: 'cancelled' } });
  await upsert(db, U.a, req);
  const done = { ...req, status: 'Withdrawn', withdrawal: { ...req.withdrawal, status: 'approved', decidedAt: 'y', decidedBy: 'lead', previousStatus: 'Active' } };
  await upsert(db, U.lead, done);
  await fails(upsert(db, U.a, { ...done, name: 'Renamed' }), /withdrawn: only the governance team/);
  await fails(as(db, U.a, `delete from public.v2_products where id = 'pw'`).then(async () => { if ((await read(db, 'pw'))) throw new Error('still there: refused'); }), /refused/);
  assert.ok(entries(await ledger(db, 'pw')).some((e) => e.kind === 'status' && e.data.to === 'Withdrawn'), 'withdrawal is in the record');
  // an administrator deletes it permanently; the record keeps the deletion
  await as(db, U.admin, `delete from public.v2_products where id = 'pw'`);
  assert.equal(await read(db, 'pw'), undefined);
  assert.equal(entries(await ledger(db, 'pw')).at(-1).kind, 'deleted');
});

test('test sweep fixes: unblocking a live product, retired products, closed rounds and repeated entries', async () => {
  const { db, orgA } = await setup();
  const done = (o = {}) => stage({ status: 'approved', approvals: { assessor: { outcome: 'Approved' } }, ...o });
  const live = product('lv', orgA, { status: 'Blocked', stage: 7, nextReview: '2027-01-01', stages: { 6: done({ log: [{ who: 'assessor', outcome: 'Approved', at: 't6' }] }), 7: stage() } });
  await upsert(db, U.admin, live);
  await fails(upsert(db, U.a, { ...live, status: 'Active' }), /governance team/);
  await upsert(db, U.a, { ...live, status: 'In production' });
  assert.equal((await read(db, 'lv')).status, 'In production', 'a re-assessment that lifts the block puts a live product back in production');
  // without an approved go-live (stage 6), Blocked cannot become In production, even when the record is missing
  const nolive = product('nl', orgA, { status: 'Blocked', stage: 9, nextReview: '2027-01-01', stages: { 9: stage() } });
  await upsert(db, U.admin, nolive);
  await fails(upsert(db, U.a, { ...nolive, status: 'In production' }), /governance team/);
  // retired: frozen for clients
  const ret = product('rt', orgA, { status: 'Retired', stage: 10, nextReview: null, stages: { 10: done() } });
  await upsert(db, U.admin, ret);
  await fails(upsert(db, U.a, { ...ret, card: { summary: 'late edit' } }), /retired/);
  // a change round: the event stage starts again, the old record is kept in rounds and is not reported as removed
  const p = { ...live, status: 'In production', stages: { ...live.stages, 8: done({ log: [{ who: 'client', outcome: 'Submitted', at: 's1' }, { who: 'assessor', outcome: 'Approved', at: 'a1' }] }) } };
  await upsert(db, U.admin, p);
  await upsert(db, U.a, { ...p, stage: 8, rounds: [{ stage: 8, record: p.stages[8] }], stages: { ...p.stages, 8: stage() } });
  const rows = (await db.query(`select kind, body from public.v2_ledger where chain = 'lv' order by seq`)).rows;
  assert.ok(!rows.some((x) => x.kind === 'decision-removed'), 'a closed round is not a removal');
  // dropping the entries instead is still recorded
  await upsert(db, U.admin, { ...p, stage: 7 });
  await upsert(db, U.admin, { ...p, stage: 7, stages: { ...p.stages, 8: stage() } });
  const rows2 = (await db.query(`select kind from public.v2_ledger where chain = 'lv' order by seq`)).rows;
  assert.equal(rows2.filter((x) => x.kind === 'decision-removed').length, 2, 'dropped entries are recorded as removed');
  // two identical entries are two entries in the record
  const dup = product('dp', orgA, { status: 'Active', stages: { 1: stage({ log: [{ who: 'client', outcome: 'Submitted' }, { who: 'client', outcome: 'Submitted' }] }) } });
  await upsert(db, U.admin, dup);
  const d = (await db.query(`select count(*)::int as n from public.v2_ledger where chain = 'dp' and kind = 'decision'`)).rows[0].n;
  assert.equal(d, 2);
});

test('product versions: a save over a newer version is refused, and each save counts up', async () => {
  const { db, orgA } = await setup();
  const p = product('vv', orgA, { status: 'Active' });
  await upsert(db, U.admin, p);
  const rev = async () => Number((await db.query(`select rev from public.v2_products where id = 'vv'`)).rows[0].rev);
  assert.equal(await rev(), 0);
  const save = (uid, data, r) => as(db, uid, `insert into public.v2_products (id, client_id, code, name, status, stage, data, rev) values ($1, $2, $3, $4, $5, $6, $7, $8)
    on conflict (id) do update set name = excluded.name, data = excluded.data, rev = excluded.rev`, [data.id, data.clientId, data.code, data.name, data.status, data.stage, data, r]);
  await save(U.a, { ...p, card: { summary: 'first' } }, 0);
  assert.equal(await rev(), 1);
  await fails(save(U.a, { ...p, card: { summary: 'stale' } }, 0), /Someone else changed/);
  await save(U.a, { ...p, card: { summary: 'second' } }, 1);
  assert.equal(await rev(), 2);
  await upsert(db, U.admin, { ...p, card: { summary: 'operator fix' } });   // a write without rev keeps counting
  assert.equal(await rev(), 3);
});

test('backup and restore: deleted products come back with their record, which still verifies', async () => {
  const { db, orgA } = await setup();
  const { verifyChain } = await import('../../src/lib/ledger.js');
  const { execFileSync } = await import('node:child_process');
  const { writeFileSync } = await import('node:fs');
  const p = product('bk', orgA, { status: 'Active', stages: { 1: stage({ log: [{ who: 'client', outcome: 'Submitted', at: 'x' }] }) } });
  await upsert(db, U.admin, p);
  await upsert(db, U.admin, { ...p, name: 'Renamed' });
  const all = async (t, o) => (await db.query(`select * from public.${t} order by ${o}`)).rows;
  const backup = { format: 'governai-backup', version: 1, exportedAt: new Date().toISOString(), tables: {
    v2_clients: await all('v2_clients', 'id'), v2_profiles: await all('v2_profiles', 'id'), v2_products: await all('v2_products', 'id'),
    v2_notes: [], v2_settings: await all('v2_settings', 'key'), v2_audit: await all('v2_audit', 'id'), v2_ledger: await all('v2_ledger', 'chain, seq') } };
  const ledgerBefore = backup.tables.v2_ledger.filter((r) => r.chain === 'bk');
  await as(db, U.admin, `delete from public.v2_products where id = 'bk'`);
  writeFileSync('/tmp/gov-backup.json', JSON.stringify(backup));
  const sql = execFileSync(process.execPath, [new URL('../../scripts/backup-to-sql.mjs', import.meta.url).pathname, '/tmp/gov-backup.json']).toString();
  await db.exec(sql);
  await db.exec(sql);   // running it twice changes nothing
  const back = (await db.query(`select data, rev from public.v2_products where id = 'bk'`)).rows[0];
  assert.equal(back.data.name, 'Renamed');
  const chain = (await db.query(`select * from public.v2_ledger where chain = 'bk' order by seq`)).rows;
  assert.ok(chain.length >= ledgerBefore.length + 1, 'the deletion stays on record too');
  assert.ok((await verifyChain(chain)).ok, 'record still verifies');
  const auditCount = (await db.query('select count(*)::int n from public.v2_audit')).rows[0].n;
  await db.exec(sql);
  assert.equal((await db.query('select count(*)::int n from public.v2_audit')).rows[0].n, auditCount, 'audit rows not duplicated');
});

test('error reports: people add their own, at most 30 an hour; only administrators read them', async () => {
  const { db } = await setup();
  for (let i = 0; i < 35; i++) await as(db, U.a, `insert into public.v2_client_errors (message, page) values ($1, '#x')`, [`boom ${i}`]);
  const n = (await db.query('select count(*)::int n from public.v2_client_errors')).rows[0].n;
  assert.equal(n, 30);
  await fails(as(db, U.a, `insert into public.v2_client_errors (message, user_id) values ('x', '${U.b}')`), /row-level security|violates/);
  assert.equal((await as(db, U.a, 'select * from public.v2_client_errors')).rows.length, 0, 'clients cannot read reports');
  assert.equal((await as(db, U.admin, 'select * from public.v2_client_errors')).rows.length, 30, 'administrators can');
  const h = (await as(db, U.a, 'select public.gov_health() h')).rows[0].h;
  assert.equal(h.db, true);
});

test('twenty people saving the same version at once: exactly one save wins', async () => {
  const { db, orgA } = await setup();
  const p = product('race', orgA, { status: 'Active' });
  await upsert(db, U.admin, p);
  const save = (i) => as(db, i % 2 ? U.a : U.admin, `insert into public.v2_products (id, client_id, code, name, status, stage, data, rev) values ($1, $2, $3, $4, $5, $6, $7, 0)
    on conflict (id) do update set data = excluded.data, rev = excluded.rev`, [p.id, p.clientId, p.code, p.name, p.status, p.stage, { ...p, card: { summary: `writer ${i}` } }]);
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => save(i)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => /Someone else changed/.test(r.reason.message)));
  assert.equal(Number((await db.query(`select rev from public.v2_products where id = 'race'`)).rows[0].rev), 1);
});
