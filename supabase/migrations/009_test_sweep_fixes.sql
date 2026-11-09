-- Fixes from the November 2026 test sweep.
--
-- 1. Re-assessment of a product that was blocked while in production: when the new assessment lifts the block, the
--    product returns to "In production" (it had passed go-live), not "Active". Clients may make that one change.
-- 2. Retired products are read-only for clients, like withdrawn ones.
-- 3. Stage rounds: when a stage is started again (stage 7 after a change, a second change or incident), the app keeps
--    the finished record in data.rounds. The record no longer reports those log entries as removed, because they are
--    still in the product.

-- ---------- 1. lifecycle changes a client may make (005, with the unblock rule refined) ----------
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
       or (old_status = 'Blocked' and new_status = 'Active' and not (old_stage >= 7 and coalesce(old.data -> 'stages' -> '6' ->> 'status', '') = 'approved'))
       or (old_status = 'Blocked' and new_status = 'In production' and old_stage >= 7 and coalesce(old.data -> 'stages' -> '6' ->> 'status', '') = 'approved')) then
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


-- ---------- 2. withdrawn and retired products are read-only for clients ----------
create or replace function public.gov_guard_withdrawal() returns trigger
language plpgsql security definer set search_path = public as $$
declare ow jsonb := old.data -> 'withdrawal'; nw jsonb := new.data -> 'withdrawal';
begin
  if public.gov_is_team() then return new; end if;
  if old.data ->> 'status' = 'Withdrawn' then
    raise exception 'This product was withdrawn: only the governance team can change it' using errcode = '42501';
  end if;
  if old.data ->> 'status' = 'Retired' then
    raise exception 'This product is retired: only the governance team can change it' using errcode = '42501';
  end if;
  if nw is distinct from ow then
    if nw is null or coalesce(nw ->> 'status', '') not in ('requested', 'cancelled')
       or nw ? 'decidedAt' or nw ? 'decidedBy' or nw ? 'previousStatus' then
      raise exception 'Only the governance team can decide a withdrawal' using errcode = '42501';
    end if;
    if nw ->> 'status' = 'cancelled' and coalesce(ow ->> 'status', '') <> 'requested' then
      raise exception 'Only a pending withdrawal request can be cancelled' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.gov_guard_withdrawal() from public, anon, authenticated;

-- ---------- 3. the record and closed stage rounds ----------
create or replace function public.gov_ledger_product() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k text; e jsonb; ol jsonb; nl jsonb; rl jsonb; d jsonb; kid text; cnt int; other int; i int;
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
    -- Entries kept in closed rounds of this stage (data.rounds) are still part of the product.
    rl := coalesce((select jsonb_agg(o) from jsonb_array_elements(case when jsonb_typeof(d -> 'rounds') = 'array' then d -> 'rounds' else '[]'::jsonb end) rd,
                    jsonb_array_elements(case when jsonb_typeof(rd -> 'record' -> 'log') = 'array' then rd -> 'record' -> 'log' else '[]'::jsonb end) o
                    where rd ->> 'stage' = k), '[]'::jsonb);
    -- Counted, not just matched, so two identical entries are two entries.
    for e, cnt in select x, count(*)::int from jsonb_array_elements(nl) with ordinality t(x, n) group by x order by min(n) loop
      other := (select count(*)::int from jsonb_array_elements(ol) o where o = e);
      for i in 1 .. cnt - other loop
        perform public.gov_ledger_append(new.id, kid, 'decision', jsonb_build_object('stage', k, 'entry', e)
          || case when e ->> 'outcome' = 'Submitted' then jsonb_build_object('submitted', public.gov_stage_fingerprint(d -> 'stages' -> k)) else '{}'::jsonb end);
      end loop;
    end loop;
    for e, cnt in select x, count(*)::int from jsonb_array_elements(ol) with ordinality t(x, n) group by x order by min(n) loop
      other := (select count(*)::int from jsonb_array_elements(nl) o where o = e)
             + (select count(*)::int from jsonb_array_elements(rl) o where o = e)
             - (select count(*)::int from jsonb_array_elements(case when tg_op = 'UPDATE' and jsonb_typeof(old.data -> 'rounds') = 'array' then old.data -> 'rounds' else '[]'::jsonb end) rd,
                       jsonb_array_elements(case when jsonb_typeof(rd -> 'record' -> 'log') = 'array' then rd -> 'record' -> 'log' else '[]'::jsonb end) o
                       where rd ->> 'stage' = k and o = e);
      for i in 1 .. cnt - other loop
        perform public.gov_ledger_append(new.id, kid, 'decision-removed', jsonb_build_object('stage', k, 'entry', e));
      end loop;
    end loop;
  end loop;
  return new;
end $$;
revoke execute on function public.gov_guard_product(), public.gov_ledger_product() from public, anon, authenticated;
