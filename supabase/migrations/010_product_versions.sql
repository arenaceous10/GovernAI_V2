-- Two people editing the same product at once.
--
-- Every product row carries a version number (rev). A save must send the version it started from; if someone else
-- saved in between, the save is refused (error 40001) and the app loads the latest version instead of silently
-- overwriting the other person's work. Each accepted update adds 1. Writes that do not mention rev (SQL by an
-- operator) keep the stored number, so they are accepted and counted.

alter table public.v2_products add column if not exists rev bigint not null default 0;

create or replace function public.gov_product_rev() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- INSERT ... ON CONFLICT DO UPDATE reaches here as an UPDATE carrying the sender's rev.
  if new.rev is distinct from old.rev then
    raise exception 'Someone else changed % while you were working on it', coalesce(old.data ->> 'name', old.id)
      using errcode = '40001', hint = 'Load the latest version and make the change again.';
  end if;
  new.rev := old.rev + 1;
  return new;
end $$;
revoke execute on function public.gov_product_rev() from public, anon, authenticated;

-- Named to run before the other BEFORE UPDATE triggers (they fire in name order).
drop trigger if exists gov_0_product_rev on public.v2_products;
create trigger gov_0_product_rev before update on public.v2_products
  for each row execute function public.gov_product_rev();
