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
const U = { a: '00000000-0000-0000-0000-00000000000a', b: '00000000-0000-0000-0000-00000000000b', rev: '00000000-0000-0000-0000-0000000000e1', lead: '00000000-0000-0000-0000-0000000000e2', pend: '00000000-0000-0000-0000-0000000000f1' };

async function setup() {
  const db = new PGlite();
  await db.exec(PRELUDE);
  for (const f of ['001_governai_v2.sql', '002_evidence_files.sql', '003_auth_rbac.sql', '004_ai_usage.sql', '005_security_fixes.sql']) await db.exec(MIG(f));
  await db.exec(`grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    revoke insert, update, delete on public.v2_ai_usage from anon, authenticated;`);
  const signup = (id, email, meta) => db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, meta]);
  await signup(U.a, 'a@a.test', { side: 'client', company: 'Org A', name: 'Ann A' });
  await signup(U.b, 'b@b.test', { side: 'client', company: 'Org B', name: 'Bob B' });
  await signup(U.rev, 'r@gov.test', { side: 'team', requested_role: 'assessor', name: 'Rita Reviewer' });
  await signup(U.lead, 'l@gov.test', { side: 'team', requested_role: 'lead', name: 'Lee Lead' });
  await signup(U.pend, 'p@a.test', { side: 'client', company: 'org a', name: 'Pat Pending' });
  await db.exec(`update public.v2_profiles set status = 'active' where id in ('${U.a}', '${U.b}');
                 update public.v2_profiles set role = 'assessor', status = 'active' where id = '${U.rev}';
                 update public.v2_profiles set role = 'lead', status = 'active' where id = '${U.lead}';`);
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
