-- Running GovernAI without paid tools.
--
-- 1. Error reports: when a screen fails for someone, the app records what broke (page, message, short stack) so an
--    administrator can see it under Settings > System health. Signed-in people may add reports about themselves only,
--    at most 30 an hour each; only administrators can read them; reports older than 60 days are cleared.
-- 2. gov_health(): a tiny public check the /api/health endpoint calls. It shows the database is up and, called every
--    day by the scheduled job, keeps a free Supabase project from pausing for inactivity.
-- 3. Per-organisation AI switch: v2_clients.ai_questions (null = follow the global setting, false = never send this
--    organisation's descriptions to the AI service).

create table if not exists public.v2_client_errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid not null default auth.uid(),
  role text,
  page text check (char_length(page) <= 200),
  message text not null check (char_length(message) <= 500),
  detail text check (char_length(detail) <= 2000),
  build text check (char_length(build) <= 40)
);
create index if not exists v2_client_errors_at on public.v2_client_errors (at desc);
create index if not exists v2_client_errors_user_at on public.v2_client_errors (user_id, at desc);
alter table public.v2_client_errors enable row level security;
drop policy if exists v2_client_errors_insert on public.v2_client_errors;
create policy v2_client_errors_insert on public.v2_client_errors for insert to authenticated with check (user_id = auth.uid());
drop policy if exists v2_client_errors_read on public.v2_client_errors;
create policy v2_client_errors_read on public.v2_client_errors for select to authenticated using (public.gov_role() = 'admin');
drop policy if exists v2_client_errors_delete on public.v2_client_errors;
create policy v2_client_errors_delete on public.v2_client_errors for delete to authenticated using (public.gov_role() = 'admin');
grant select, insert, delete on public.v2_client_errors to authenticated;
revoke update on public.v2_client_errors from anon, authenticated;

create or replace function public.gov_error_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.v2_client_errors where user_id = new.user_id and at > now() - interval '1 hour') >= 30 then
    return null;   -- quietly drop: a broken screen in a loop must not fill the table
  end if;
  new.at := now();
  new.role := coalesce(public.gov_role(), new.role);
  if random() < 0.02 then delete from public.v2_client_errors where at < now() - interval '60 days'; end if;
  return new;
end $$;
revoke execute on function public.gov_error_limit() from public, anon, authenticated;
drop trigger if exists gov_error_limit on public.v2_client_errors;
create trigger gov_error_limit before insert on public.v2_client_errors for each row execute function public.gov_error_limit();

create or replace function public.gov_health() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('db', true, 'at', now(), 'products', (select count(*) from public.v2_products) > -1)
$$;
revoke all on function public.gov_health() from public;
grant execute on function public.gov_health() to anon, authenticated;

alter table public.v2_clients add column if not exists ai_questions boolean;
