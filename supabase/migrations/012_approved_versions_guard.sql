-- Approved model versions. When go-live (stage 6) or a change (stage 8) is approved, the app records the model
-- version that the approval covers in data.approvedVersions. A "new version found" alert from the model registry
-- stays open, and control credit in the risk score stays suspended, until that version appears in the list.
-- The list is therefore a governance decision: only the governance team may write it. Clients keep everything else
-- they could do before. Without this migration the app works the same; the list is then only protected in the browser.
create or replace function public.gov_guard_approved_versions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.gov_is_team() then return new; end if;
  if tg_op = 'INSERT' then
    -- The app saves with an upsert, which fires this INSERT trigger even when the row exists: an existing row is
    -- checked by the UPDATE trigger instead (same pattern as gov_guard_product).
    if exists (select 1 from public.v2_products where id = new.id) then return new; end if;
    if new.data ? 'approvedVersions' and coalesce(new.data -> 'approvedVersions', '[]'::jsonb) not in ('[]'::jsonb, 'null'::jsonb) then
      raise exception 'Only the governance team records approved model versions' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.data -> 'approvedVersions') is distinct from (old.data -> 'approvedVersions') then
    raise exception 'Only the governance team records approved model versions' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.gov_guard_approved_versions() from public, anon, authenticated;
drop trigger if exists gov_guard_approved_versions on public.v2_products;
create trigger gov_guard_approved_versions before insert or update on public.v2_products for each row execute function public.gov_guard_approved_versions();
