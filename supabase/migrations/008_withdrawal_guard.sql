-- Withdrawing AI products. A client may ask to withdraw a registered product (data.withdrawal.status 'requested') or
-- cancel its own request; only the governance team decides, and once a product is withdrawn only the team can change
-- it. Deleting stays as before: clients delete their own drafts, administrators any product (the app allows that only
-- for withdrawn or retired products after the retention period). The tamper-evident record (007) keeps every step.
create or replace function public.gov_guard_withdrawal() returns trigger
language plpgsql security definer set search_path = public as $$
declare ow jsonb := old.data -> 'withdrawal'; nw jsonb := new.data -> 'withdrawal';
begin
  if public.gov_is_team() then return new; end if;
  if old.data ->> 'status' = 'Withdrawn' then
    raise exception 'This product was withdrawn: only the governance team can change it' using errcode = '42501';
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
drop trigger if exists gov_guard_withdrawal on public.v2_products;
create trigger gov_guard_withdrawal before update on public.v2_products for each row execute function public.gov_guard_withdrawal();
revoke execute on function public.gov_guard_withdrawal() from public, anon, authenticated;
