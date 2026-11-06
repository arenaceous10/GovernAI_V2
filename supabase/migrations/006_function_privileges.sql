-- Supabase security advisor follow-up.
-- Functions are executable by PUBLIC by default. Helpers used inside row-level security policies must stay
-- executable for signed-in users; nobody needs them anonymously. Trigger functions run as triggers and are never
-- called directly, so nobody needs to execute them.
alter function public.gov_log_ok(jsonb, jsonb) set search_path = public;
revoke execute on function public.gov_role(), public.gov_client(), public.gov_is_team(), public.gov_log_ok(jsonb, jsonb) from public, anon;
grant execute on function public.gov_role(), public.gov_client(), public.gov_is_team(), public.gov_log_ok(jsonb, jsonb) to authenticated;
revoke execute on function public.gov_handle_new_user(), public.gov_stamp_audit(), public.gov_guard_product() from public, anon, authenticated;
revoke execute on function public.ai_usage_take(int, int, int) from public, anon;
