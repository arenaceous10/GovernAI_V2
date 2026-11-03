-- GovernAI V2: sign-in and role-based access.
-- Replaces the demo open-access policies. Every table now requires a signed-in, approved user,
-- and each role reads and writes only what it may.

-- ---------- profiles: one row per signed-in user ----------
create table if not exists public.v2_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null default '',
  side text not null check (side in ('client', 'team')),
  role text check (role in ('client', 'assessor', 'lead', 'admin')),
  requested_role text,
  company text,
  client_id text references public.v2_clients (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- internal notes: governance team only ----------
create table if not exists public.v2_notes (
  id text primary key,
  product_id text not null,
  stage int not null,
  at timestamptz not null default now(),
  by_role text,
  by_name text,
  text text not null
);
create index if not exists v2_notes_product_idx on public.v2_notes (product_id);

alter table public.v2_audit add column if not exists actor_name text;

alter table public.v2_profiles enable row level security;
alter table public.v2_notes enable row level security;

-- ---------- who is calling (security definer so policies can read profiles) ----------
create or replace function public.gov_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.v2_profiles where id = auth.uid() and status = 'active'
$$;
create or replace function public.gov_client() returns text
language sql stable security definer set search_path = public as $$
  select client_id from public.v2_profiles where id = auth.uid() and status = 'active' and role = 'client'
$$;
create or replace function public.gov_is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.gov_role() in ('assessor', 'lead', 'admin'), false)
$$;
revoke all on function public.gov_role(), public.gov_client(), public.gov_is_team() from anon;

-- ---------- new sign-ups get a profile; nobody chooses their own access ----------
create or replace function public.gov_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_side text := case when meta->>'side' = 'team' then 'team' else 'client' end;
  v_company text := nullif(trim(meta->>'company'), '');
  v_client text;
  v_status text := 'pending';
begin
  if v_side = 'client' and v_company is not null then
    select id into v_client from public.v2_clients where lower(name) = lower(v_company) limit 1;
    if v_client is null then
      -- a new organisation: its first user is active straight away
      v_client := 'cli-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
      insert into public.v2_clients (id, name) values (v_client, v_company);
      v_status := 'active';
    end if;
    -- joining an existing organisation waits for an administrator
  end if;
  insert into public.v2_profiles (id, email, name, side, role, requested_role, company, client_id, status)
  values (
    new.id, new.email, coalesce(nullif(trim(meta->>'name'), ''), split_part(new.email, '@', 1)), v_side,
    case when v_side = 'client' then 'client' else null end,
    case when v_side = 'team' and meta->>'requested_role' in ('assessor', 'lead') then meta->>'requested_role' else null end,
    v_company, v_client, v_status
  );
  return new;
end $$;
revoke all on function public.gov_handle_new_user() from anon, authenticated;
drop trigger if exists gov_on_auth_user_created on auth.users;
create trigger gov_on_auth_user_created after insert on auth.users
  for each row execute function public.gov_handle_new_user();

-- ---------- drop demo access ----------
drop policy if exists "demo open access" on public.v2_clients;
drop policy if exists "demo open access" on public.v2_users;
drop policy if exists "demo open access" on public.v2_products;
drop policy if exists "demo open access" on public.v2_audit;
drop policy if exists "demo open access" on public.v2_settings;
drop policy if exists "v2 evidence demo read" on storage.objects;
drop policy if exists "v2 evidence demo upload" on storage.objects;
drop policy if exists "v2 evidence demo delete" on storage.objects;

-- ---------- profiles ----------
create policy "own profile or admin" on public.v2_profiles for select to authenticated
  using (id = auth.uid() or public.gov_role() = 'admin');
create policy "admin manages profiles" on public.v2_profiles for update to authenticated
  using (public.gov_role() = 'admin') with check (public.gov_role() = 'admin');

-- ---------- clients ----------
create policy "team sees all, client sees own" on public.v2_clients for select to authenticated
  using (public.gov_is_team() or id = public.gov_client());
create policy "admin writes clients" on public.v2_clients for all to authenticated
  using (public.gov_role() = 'admin') with check (public.gov_role() = 'admin');

-- ---------- products ----------
create policy "team sees all, client sees own" on public.v2_products for select to authenticated
  using (public.gov_is_team() or client_id = public.gov_client());
create policy "client creates own, admin any" on public.v2_products for insert to authenticated
  with check (client_id = public.gov_client() or public.gov_role() = 'admin');
create policy "client updates own, team reviews" on public.v2_products for update to authenticated
  using (client_id = public.gov_client() or public.gov_is_team())
  with check (client_id = public.gov_client() or public.gov_is_team());
create policy "client deletes own drafts, admin any" on public.v2_products for delete to authenticated
  using ((client_id = public.gov_client() and status = 'Draft') or public.gov_role() = 'admin');

-- ---------- audit ----------
create policy "team sees all, client sees own" on public.v2_audit for select to authenticated
  using (public.gov_is_team() or org = public.gov_client());
create policy "approved users add entries" on public.v2_audit for insert to authenticated
  with check (public.gov_role() is not null and (org is null or org = public.gov_client() or public.gov_is_team()));
create policy "admin clears audit" on public.v2_audit for delete to authenticated
  using (public.gov_role() = 'admin');

-- ---------- settings ----------
create policy "signed-in users read settings" on public.v2_settings for select to authenticated using (true);
create policy "admin writes settings" on public.v2_settings for all to authenticated
  using (public.gov_role() = 'admin') with check (public.gov_role() = 'admin');

-- ---------- legacy demo users list: admin only ----------
create policy "admin only" on public.v2_users for all to authenticated
  using (public.gov_role() = 'admin') with check (public.gov_role() = 'admin');

-- ---------- internal notes ----------
create policy "team reads notes" on public.v2_notes for select to authenticated using (public.gov_is_team());
create policy "reviewers add notes" on public.v2_notes for insert to authenticated
  with check (public.gov_role() in ('assessor', 'lead', 'admin'));
create policy "admin deletes notes" on public.v2_notes for delete to authenticated using (public.gov_role() = 'admin');

-- ---------- evidence files: team reads all; a client reads and writes files of its own products ----------
create policy "v2 evidence read" on storage.objects for select to authenticated
  using (bucket_id = 'v2-evidence' and (public.gov_is_team() or exists (
    select 1 from public.v2_products p where p.id = split_part(name, '/', 1) and p.client_id = public.gov_client())));
create policy "v2 evidence upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'v2-evidence' and exists (
    select 1 from public.v2_products p where p.id = split_part(name, '/', 1) and p.client_id = public.gov_client()));
create policy "v2 evidence delete" on storage.objects for delete to authenticated
  using (bucket_id = 'v2-evidence' and (public.gov_role() = 'admin' or exists (
    select 1 from public.v2_products p where p.id = split_part(name, '/', 1) and p.client_id = public.gov_client())));
