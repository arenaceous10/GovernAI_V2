-- GovernAI v2 tables. Prefixed v2_ so the existing use_cases/checklist/... tables are untouched.
create table if not exists public.v2_clients (
  id text primary key,
  name text not null,
  sector text,
  contact text,
  created_at timestamptz not null default now()
);

create table if not exists public.v2_users (
  id text primary key,
  name text not null,
  email text not null,
  role text not null check (role in ('client', 'assessor', 'lead', 'admin')),
  client_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.v2_products (
  id text primary key,
  client_id text,
  code text,
  name text,
  status text,
  stage int not null default 1,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists v2_products_client_idx on public.v2_products (client_id);

create table if not exists public.v2_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text,
  org text,
  action text not null,
  target text,
  detail text
);
create index if not exists v2_audit_at_idx on public.v2_audit (at desc);

create table if not exists public.v2_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.v2_clients enable row level security;
alter table public.v2_users enable row level security;
alter table public.v2_products enable row level security;
alter table public.v2_audit enable row level security;
alter table public.v2_settings enable row level security;

-- DEMO ACCESS: the app has no real login yet, so the browser key may read and write sample data.
-- Replace these with per-user policies when sign-in is added.
create policy "demo open access" on public.v2_clients for all to anon, authenticated using (true) with check (true);
create policy "demo open access" on public.v2_users for all to anon, authenticated using (true) with check (true);
create policy "demo open access" on public.v2_products for all to anon, authenticated using (true) with check (true);
create policy "demo open access" on public.v2_audit for all to anon, authenticated using (true) with check (true);
create policy "demo open access" on public.v2_settings for all to anon, authenticated using (true) with check (true);
