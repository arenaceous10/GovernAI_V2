-- GovernAI V2: evidence file storage.
-- Private bucket: files are opened through short-lived signed links, never public URLs.
-- Same demo-open access as the v2_ tables. Replace with per-organisation rules when real sign-in is added.

insert into storage.buckets (id, name, public, file_size_limit)
values ('v2-evidence', 'v2-evidence', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

drop policy if exists "v2 evidence demo read" on storage.objects;
drop policy if exists "v2 evidence demo upload" on storage.objects;
drop policy if exists "v2 evidence demo delete" on storage.objects;

create policy "v2 evidence demo read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'v2-evidence');
create policy "v2 evidence demo upload" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'v2-evidence');
create policy "v2 evidence demo delete" on storage.objects
  for delete to anon, authenticated using (bucket_id = 'v2-evidence');
