-- Per-user record of AI question-generation calls, used by /api/generate-questions to rate-limit.
-- The function inserts with the caller's own token, so RLS ties each row to that user.
-- No update or delete policy: a user cannot erase their own usage to get around the limit.
create table if not exists public.v2_ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists v2_ai_usage_user_at on public.v2_ai_usage (user_id, at desc);
alter table public.v2_ai_usage enable row level security;
drop policy if exists ai_usage_insert_own on public.v2_ai_usage;
create policy ai_usage_insert_own on public.v2_ai_usage for insert to authenticated with check (user_id = auth.uid());
drop policy if exists ai_usage_select_own on public.v2_ai_usage;
create policy ai_usage_select_own on public.v2_ai_usage for select to authenticated using (user_id = auth.uid());
revoke update, delete on public.v2_ai_usage from anon, authenticated;
