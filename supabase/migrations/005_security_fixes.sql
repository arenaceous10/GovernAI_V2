-- Security fixes from the November 2026 audit.
--
-- 1. Evidence storage: the policies compared split_part(name, '/', 1) inside a subquery over v2_products, where the
--    unqualified `name` bound to v2_products.name, not the object's path. The check never looked at the file, so a
--    client owning one product with id = name could read, upload and delete every organisation's evidence, while
--    ordinary clients could not reach their own files. Qualify the column.
-- 2. Lifecycle approvals: clients could rewrite their whole product row through the REST API, so approvals,
--    stage moves and production status were enforced only in the browser. A trigger now allows clients only the
--    changes the app makes for them; approving, returning, overriding and going live stay with the governance team.
-- 3. Audit log: clients could insert entries with any actor, name, organisation and time. They are now set by the
--    database for clients.
-- 1b. Team saves: reviewers' and leads' approvals were refused by the INSERT policy on upsert. Fixed.
-- 4. AI rate limit: counting and recording were two requests, so parallel calls slipped past the limit. One locked
--    function now checks and records together, with a per-user and a global daily ceiling.
-- 5. Sign-up: a new organisation's first user waits for an administrator like everyone else, so nobody can claim a
--    company's name (and later members' data) by registering it first.

-- ---------- 1. evidence storage ----------
drop policy if exists "v2 evidence read" on storage.objects;
drop policy if exists "v2 evidence upload" on storage.objects;
drop policy if exists "v2 evidence delete" on storage.objects;
create policy "v2 evidence read" on storage.objects for select to authenticated
  using (bucket_id = 'v2-evidence' and (public.gov_is_team() or exists (
    select 1 from public.v2_products p where p.id = split_part(storage.objects.name, '/', 1) and p.client_id = public.gov_client())));
create policy "v2 evidence upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'v2-evidence' and exists (
    select 1 from public.v2_products p where p.id = split_part(storage.objects.name, '/', 1) and p.client_id = public.gov_client()));
create policy "v2 evidence delete" on storage.objects for delete to authenticated
  using (bucket_id = 'v2-evidence' and (public.gov_role() = 'admin' or exists (
    select 1 from public.v2_products p where p.id = split_part(storage.objects.name, '/', 1) and p.client_id = public.gov_client())));

-- ---------- 1b. team saves ----------
-- The app saves with upsert (INSERT ... ON CONFLICT DO UPDATE). Postgres checks the proposed row against the INSERT
-- policy even when the row exists, so assessors' and leads' approvals were refused. The team may write rows; what a
-- client may write is limited by the trigger below.
drop policy if exists "client creates own, admin any" on public.v2_products;
create policy "client creates own, team any" on public.v2_products for insert to authenticated
  with check (client_id = public.gov_client() or public.gov_is_team());

-- ---------- 2. lifecycle changes a client may make ----------
-- Log entries added by a client must be the client's own; earlier entries are kept unchanged.
create or replace function public.gov_log_ok(old_log jsonb, new_log jsonb) returns boolean
language plpgsql immutable as $$
declare i int; n_old int := coalesce(jsonb_array_length(case when jsonb_typeof(old_log) = 'array' then old_log end), 0);
begin
  if new_log is null or jsonb_typeof(new_log) <> 'array' then return n_old = 0; end if;
  if jsonb_array_length(new_log) < n_old then return false; end if;
  for i in 0 .. n_old - 1 loop if new_log -> i is distinct from old_log -> i then return false; end if; end loop;
  for i in n_old .. jsonb_array_length(new_log) - 1 loop if coalesce(new_log -> i ->> 'who', '') <> 'client' then return false; end if; end loop;
  return true;
end $$;

create or replace function public.gov_guard_product() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  k text; o jsonb; n jsonb; os text; ns text;
  old_status text; new_status text; old_stage int; new_stage int;
begin
  -- Everyone: the product's own id and organisation inside `data` must match the row, so a row cannot pose as
  -- another organisation's product in the team's screens (and be saved over it by a reviewer).
  if (new.data ->> 'id') is distinct from new.id or (new.data ->> 'clientId') is distinct from new.client_id then
    raise exception 'Product id or organisation does not match its record' using errcode = '42501';
  end if;
  if public.gov_is_team() then return new; end if;   -- governance team and administrators: no further limits

  new_status := coalesce(new.status, new.data ->> 'status');
  new_stage := coalesce(new.stage, (new.data ->> 'stage')::int, 1);
  if new.status is distinct from (new.data ->> 'status') or new_stage is distinct from coalesce((new.data ->> 'stage')::int, 1) then
    raise exception 'Product columns and data disagree' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    -- An upsert of an existing row is checked by the UPDATE trigger instead.
    if exists (select 1 from public.v2_products where id = new.id) then return new; end if;
    if new_status not in ('Draft', 'Active', 'Blocked') or new_stage <> 1 or (new.data -> 'nextReview') not in ('null'::jsonb) and new.data ? 'nextReview' then
      raise exception 'A new product starts at stage 1 without approvals' using errcode = '42501';
    end if;
    for k, n in select key, value from jsonb_each(coalesce(new.data -> 'stages', '{}'::jsonb)) loop
      if coalesce(n ->> 'status', 'open') <> 'open' or coalesce(n -> 'approvals', '{}'::jsonb) <> '{}'::jsonb or not public.gov_log_ok(null, n -> 'log') then
        raise exception 'A new product cannot carry stage decisions' using errcode = '42501';
      end if;
    end loop;
    return new;
  end if;

  -- UPDATE by a client
  old_status := coalesce(old.status, old.data ->> 'status');
  old_stage := coalesce(old.stage, (old.data ->> 'stage')::int, 1);

  if not (new_status = old_status
       or (old_status = 'Draft' and new_status in ('Active', 'Blocked'))
       or (old_status in ('Active', 'In production') and new_status = 'Blocked')
       or (old_status = 'Blocked' and new_status = 'Active')) then
    raise exception 'Only the governance team can change a product to %', new_status using errcode = '42501';
  end if;
  if (new.data -> 'nextReview') is distinct from (old.data -> 'nextReview') then
    raise exception 'Only the governance team sets the review date' using errcode = '42501';
  end if;
  if new_stage <> old_stage and not (old_stage = 7 and old_status = 'In production' and new_stage in (8, 9, 10)) then
    raise exception 'Only the governance team moves a product between stages' using errcode = '42501';
  end if;

  -- every stage that existed keeps its decisions; a stage moves only open/returned -> submitted
  for k, o in select key, value from jsonb_each(coalesce(old.data -> 'stages', '{}'::jsonb)) loop
    n := new.data -> 'stages' -> k;
    -- a change, incident or retirement re-opens its event stage from scratch (app: startEvent)
    if k::int = new_stage and new_stage <> old_stage then
      if n is null or coalesce(n ->> 'status', 'open') <> 'open' or coalesce(n -> 'approvals', '{}'::jsonb) <> '{}'::jsonb or not public.gov_log_ok(null, n -> 'log') then
        raise exception 'Stage % must start open and without decisions', k using errcode = '42501';
      end if;
      continue;
    end if;
    if n is null then
      if old_status = 'Draft' and coalesce(o ->> 'status', 'open') = 'open' then continue; end if;
      raise exception 'Stage % cannot be removed', k using errcode = '42501';
    end if;
    os := coalesce(o ->> 'status', 'open'); ns := coalesce(n ->> 'status', 'open');
    if ns = os then
      if coalesce(n -> 'approvals', '{}'::jsonb) <> coalesce(o -> 'approvals', '{}'::jsonb) then
        raise exception 'Only the governance team records approvals (stage %)', k using errcode = '42501';
      end if;
      -- under review or decided: the checklist, evidence and decision are frozen for the client
      if os in ('approved', 'submitted') and n is distinct from o then
        raise exception 'A stage under review or decided cannot be changed (stage %)', k using errcode = '42501';
      end if;
    elsif os in ('open', 'returned') and ns = 'submitted' and k::int = old_stage then
      if coalesce(n -> 'approvals', '{}'::jsonb) <> '{}'::jsonb then
        raise exception 'A submitted stage starts without approvals' using errcode = '42501';
      end if;
    else
      raise exception 'Only the governance team can mark stage % as %', k, ns using errcode = '42501';
    end if;
    if not public.gov_log_ok(o -> 'log', n -> 'log') then
      raise exception 'Stage history can only be added to, by the client, in the client''s name' using errcode = '42501';
    end if;
  end loop;
  -- stages that are new in this update: only the event stage a client may open, empty
  for k, n in select key, value from jsonb_each(coalesce(new.data -> 'stages', '{}'::jsonb)) loop
    if (old.data -> 'stages' -> k) is null then
      if not ((k::int = new_stage and new_stage <> old_stage) or old_status = 'Draft')
         or coalesce(n ->> 'status', 'open') <> 'open' or coalesce(n -> 'approvals', '{}'::jsonb) <> '{}'::jsonb
         or not public.gov_log_ok(null, n -> 'log') then
        raise exception 'Stage % cannot be added with decisions', k using errcode = '42501';
      end if;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists gov_guard_product on public.v2_products;
create trigger gov_guard_product before insert or update on public.v2_products
  for each row execute function public.gov_guard_product();

-- ---------- 3. audit entries written by clients ----------
create or replace function public.gov_stamp_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.gov_is_team() then return new; end if;
  new.at := now();
  new.actor := public.gov_role();
  new.actor_name := (select name from public.v2_profiles where id = auth.uid());
  new.org := public.gov_client();
  return new;
end $$;
drop trigger if exists gov_stamp_audit on public.v2_audit;
create trigger gov_stamp_audit before insert on public.v2_audit for each row execute function public.gov_stamp_audit();

-- ---------- 4. atomic AI usage limit ----------
drop policy if exists ai_usage_insert_own on public.v2_ai_usage;   -- rows are now written only by the function below
revoke insert on public.v2_ai_usage from anon, authenticated;

create or replace function public.ai_usage_take(per_hour int default 12, per_day int default 40, global_day int default 600)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); h int; d int; g int;
begin
  if uid is null or public.gov_role() is null or public.gov_role() not in ('client', 'admin') then return 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtext('ai_usage_global'));
  select count(*) filter (where at > now() - interval '1 hour'), count(*) into h, d
    from public.v2_ai_usage where user_id = uid and at > now() - interval '1 day';
  select count(*) into g from public.v2_ai_usage where at > now() - interval '1 day';
  if h >= least(per_hour, 12) then return 'hour'; end if;
  if d >= least(per_day, 40) then return 'day'; end if;
  if g >= least(global_day, 600) then return 'global'; end if;
  insert into public.v2_ai_usage (user_id) values (uid);
  return 'ok';
end $$;
revoke all on function public.ai_usage_take(int, int, int) from public, anon;
grant execute on function public.ai_usage_take(int, int, int) to authenticated;

-- ---------- 5. every new account waits for an administrator ----------
create or replace function public.gov_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_side text := case when meta->>'side' = 'team' then 'team' else 'client' end;
  v_company text := nullif(trim(meta->>'company'), '');
  v_client text;
begin
  if v_side = 'client' and v_company is not null then
    select id into v_client from public.v2_clients where lower(name) = lower(v_company) limit 1;
    if v_client is null then
      v_client := 'cli-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
      insert into public.v2_clients (id, name) values (v_client, v_company);
    end if;
  end if;
  insert into public.v2_profiles (id, email, name, side, role, requested_role, company, client_id, status)
  values (
    new.id, new.email, coalesce(nullif(trim(meta->>'name'), ''), split_part(new.email, '@', 1)), v_side,
    case when v_side = 'client' then 'client' else null end,
    case when v_side = 'team' and meta->>'requested_role' in ('assessor', 'lead') then meta->>'requested_role' else null end,
    v_company, v_client, 'pending'
  );
  return new;
end $$;
revoke all on function public.gov_handle_new_user() from anon, authenticated;
