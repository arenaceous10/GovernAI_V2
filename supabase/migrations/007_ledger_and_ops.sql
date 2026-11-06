-- Tamper-evident record and multi-client operations.
--
-- 1. v2_ledger: an append-only, hash-chained record per AI product. The database writes it from triggers, so the
--    browser cannot skip, reorder or rewrite it. Each entry stores the exact text that was hashed (`body`) and
--    hash = sha256(prev_hash || '\n' || body). Changing, deleting or inserting an entry breaks every later hash, and
--    sequence numbers have no gaps, so a removed entry also shows. Nobody, the governance team included, may insert,
--    update or delete ledger rows through the API.
--    Recorded: registration, status and stage moves, every stage log entry (submissions, approvals, returns,
--    overrides) with a fingerprint of what was submitted, removal or editing of an earlier log entry, audit-log
--    entries about the product, and deletion.
-- 2. v2_clients.brand: per-client logo and accent colour for the client portal and exported documents.

-- ---------- 1. ledger ----------
create table if not exists public.v2_ledger (
  chain text not null,                  -- the product id
  seq int not null,                     -- 1, 2, 3 ... per product, no gaps
  client_id text,
  at timestamptz not null default now(),
  kind text not null,
  actor text,
  body text not null,                   -- exactly the text that was hashed (JSON)
  prev text not null,
  hash text not null,
  primary key (chain, seq)
);
create index if not exists v2_ledger_client_idx on public.v2_ledger (client_id);
alter table public.v2_ledger enable row level security;
drop policy if exists "team sees all, client sees own" on public.v2_ledger;
create policy "team sees all, client sees own" on public.v2_ledger for select to authenticated
  using (public.gov_is_team() or client_id = public.gov_client());
revoke insert, update, delete, truncate on public.v2_ledger from public, anon, authenticated;
grant select on public.v2_ledger to authenticated;

create or replace function public.gov_ledger_append(p_chain text, p_client text, p_kind text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  last_seq int; last_hash text; s int; pv text; b text; t timestamptz := clock_timestamp();
  act text := coalesce(public.gov_role(), 'system');
begin
  perform pg_advisory_xact_lock(hashtext('v2_ledger:' || p_chain));
  select seq, hash into last_seq, last_hash from public.v2_ledger where chain = p_chain order by seq desc limit 1;
  s := coalesce(last_seq, 0) + 1;
  pv := coalesce(last_hash, repeat('0', 64));
  b := jsonb_build_object('chain', p_chain, 'seq', s, 'at', to_char(t at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'kind', p_kind, 'actor', act, 'data', coalesce(p_data, '{}'::jsonb))::text;
  insert into public.v2_ledger (chain, seq, client_id, at, kind, actor, body, prev, hash)
  values (p_chain, s, p_client, t, p_kind, act, b, pv, encode(sha256(convert_to(pv || E'\n' || b, 'UTF8')), 'hex'));
end $$;

-- What was submitted for a stage: checks, skips and the evidence files' names and sizes (not their contents).
create or replace function public.gov_stage_fingerprint(st jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'checklist', coalesce((select jsonb_object_agg(key, value) from jsonb_each(case when jsonb_typeof(st -> 'checklist') = 'object' then st -> 'checklist' end) where value = 'true'::jsonb), '{}'::jsonb),
    'skipped', coalesce((select jsonb_object_agg(key, value - 'at') from jsonb_each(case when jsonb_typeof(st -> 'skipped') = 'object' then st -> 'skipped' end) where jsonb_typeof(value) = 'object'), '{}'::jsonb),
    'evidence', coalesce((select jsonb_object_agg(key, case when jsonb_typeof(value) = 'object' then value - 'data' - 'url' else value end)
                          from jsonb_each(case when jsonb_typeof(st -> 'evidence') = 'object' then st -> 'evidence' end)), '{}'::jsonb))
$$;

create or replace function public.gov_ledger_product() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k text; e jsonb; ol jsonb; nl jsonb; d jsonb; kid text;
begin
  if tg_op = 'DELETE' then
    perform public.gov_ledger_append(old.id, old.client_id, 'deleted',
      jsonb_build_object('name', old.data ->> 'name', 'code', old.data ->> 'code', 'status', old.data ->> 'status', 'stage', old.data -> 'stage'));
    return old;
  end if;
  d := new.data; kid := new.client_id;
  if tg_op = 'INSERT' then
    perform public.gov_ledger_append(new.id, kid, 'registered',
      jsonb_build_object('name', d ->> 'name', 'code', d ->> 'code', 'status', d ->> 'status', 'stage', d -> 'stage'));
  else
    if (old.data ->> 'status') is distinct from (d ->> 'status') then
      perform public.gov_ledger_append(new.id, kid, 'status', jsonb_build_object('from', old.data ->> 'status', 'to', d ->> 'status'));
    end if;
    if (old.data -> 'stage') is distinct from (d -> 'stage') then
      perform public.gov_ledger_append(new.id, kid, 'stage', jsonb_build_object('from', old.data -> 'stage', 'to', d -> 'stage'));
    end if;
  end if;
  for k in
    select key from (
      select jsonb_object_keys(case when jsonb_typeof(d -> 'stages') = 'object' then d -> 'stages' else '{}'::jsonb end) as key
      union
      select jsonb_object_keys(case when tg_op = 'UPDATE' and jsonb_typeof(old.data -> 'stages') = 'object' then old.data -> 'stages' else '{}'::jsonb end)
    ) ks order by case when key ~ '^[0-9]+$' then key::int else 999 end, key
  loop
    nl := case when jsonb_typeof(d -> 'stages' -> k -> 'log') = 'array' then d -> 'stages' -> k -> 'log' else '[]'::jsonb end;
    ol := case when tg_op = 'UPDATE' and jsonb_typeof(old.data -> 'stages' -> k -> 'log') = 'array' then old.data -> 'stages' -> k -> 'log' else '[]'::jsonb end;
    for e in select x from jsonb_array_elements(nl) x loop
      if not exists (select 1 from jsonb_array_elements(ol) o where o = e) then
        perform public.gov_ledger_append(new.id, kid, 'decision', jsonb_build_object('stage', k, 'entry', e)
          || case when e ->> 'outcome' = 'Submitted' then jsonb_build_object('submitted', public.gov_stage_fingerprint(d -> 'stages' -> k)) else '{}'::jsonb end);
      end if;
    end loop;
    for e in select x from jsonb_array_elements(ol) x loop
      if not exists (select 1 from jsonb_array_elements(nl) o where o = e) then
        perform public.gov_ledger_append(new.id, kid, 'decision-removed', jsonb_build_object('stage', k, 'entry', e));
      end if;
    end loop;
  end loop;
  return new;
end $$;
drop trigger if exists gov_ledger_product on public.v2_products;
create trigger gov_ledger_product after insert or update or delete on public.v2_products
  for each row execute function public.gov_ledger_product();

create or replace function public.gov_ledger_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  select client_id into c from public.v2_products where id = new.target;
  if found then
    perform public.gov_ledger_append(new.target, c, 'audit', jsonb_build_object(
      'action', new.action, 'detail', new.detail, 'by', new.actor_name, 'role', new.actor, 'at', new.at));
  end if;
  return new;
end $$;
drop trigger if exists gov_ledger_audit on public.v2_audit;
create trigger gov_ledger_audit after insert on public.v2_audit for each row execute function public.gov_ledger_audit();

revoke execute on function public.gov_ledger_append(text, text, text, jsonb), public.gov_ledger_product(), public.gov_ledger_audit()
  from public, anon, authenticated;
revoke execute on function public.gov_stage_fingerprint(jsonb) from public, anon;

-- Existing products start their record now: a baseline, then the log entries they already have.
do $$
declare p record; k text; e jsonb;
begin
  for p in select * from public.v2_products where not exists (select 1 from public.v2_ledger l where l.chain = v2_products.id) order by created_at loop
    perform public.gov_ledger_append(p.id, p.client_id, 'baseline', jsonb_build_object('name', p.data ->> 'name', 'code', p.data ->> 'code',
      'status', p.data ->> 'status', 'stage', p.data -> 'stage', 'note', 'Record started; earlier entries were copied from the product as it stood.'));
    for k in select key from jsonb_object_keys(case when jsonb_typeof(p.data -> 'stages') = 'object' then p.data -> 'stages' else '{}'::jsonb end) key
             order by case when key ~ '^[0-9]+$' then key::int else 999 end loop
      for e in select x from jsonb_array_elements(case when jsonb_typeof(p.data -> 'stages' -> k -> 'log') = 'array' then p.data -> 'stages' -> k -> 'log' else '[]'::jsonb end) x loop
        perform public.gov_ledger_append(p.id, p.client_id, 'decision', jsonb_build_object('stage', k, 'entry', e, 'copied', true));
      end loop;
    end loop;
  end loop;
end $$;

-- ---------- 2. client branding ----------
alter table public.v2_clients add column if not exists brand jsonb;
