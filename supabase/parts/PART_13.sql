-- HOME OS PART 13 OF 13 (profile editing: phone + avatar photos).
-- Mirrors the hosted setup page exactly. Hardened: safe to re-run.

-- HOME OS ULTIMATE - PART 13: profile editing.
-- Adds the phone column and a private avatars storage bucket with RLS.


insert into storage.buckets (id, name, public)
values ('homeos-avatars', 'homeos-avatars', false)
on conflict (id) do nothing;

-- Avatar objects live at <profile_id>/<file>. You read/write only your own
-- folder; active family members can read each other's avatars.
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select using (
  bucket_id = 'homeos-avatars'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1 from public.profiles me
      join public.profiles other on other.family_id = me.family_id
      where me.id = auth.uid() and me.status = 'active'
        and other.id = ((storage.foldername(name))[1])::uuid
    )
  )
);
drop policy if exists avatars_write on storage.objects;
create policy avatars_write on storage.objects for insert with check (
  bucket_id = 'homeos-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active')
);
drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update using (
  bucket_id = 'homeos-avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects for delete using (
  bucket_id = 'homeos-avatars' and (storage.foldername(name))[1] = auth.uid()::text
);


select 'HOME OS ULTIMATE: database ready ✅' as status,
       (select count(*) from pg_tables where schemaname = 'public') as tables,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public') as functions;
