-- HOME OS PART 11 OF 11
-- ============================================================================
-- HOME OS ULTIMATE - Stage 5: documents/archive (Supabase Storage),
-- notification settings + notify(), nothing client-side may insert
-- notifications directly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Documents: categorization + links to any section entity
-- ---------------------------------------------------------------------------
alter table public.documents
  add column category text not null default 'general'
    check (category in ('general','receipt','invoice','contract','photo','plan','other')),
  add column entity_type text
    check (entity_type is null or entity_type in
      ('transaction','task','request','room','stage','asset','event','maintenance')),
  add column entity_id text,
  add column tags text[] not null default '{}';

-- Documents: family members may add family-visible files; owner_only files
-- are created and read by the owner alone (select policy from stage 2b).
drop policy if exists documents_insert on public.documents;

drop policy if exists documents_write on public.documents;

create policy documents_insert on public.documents for insert
  with check (
    public.is_family_member(family_id)
    and owner_id = auth.uid()
    and (visibility = 'family' or public.is_family_owner(family_id))
  );

create policy documents_delete on public.documents for delete
  using (public.is_family_owner(family_id) or owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Storage: one private bucket. Path layout enforces the visibility boundary:
--   {family_id}/family/{uuid}-{filename}       readable by all family members
--   {family_id}/owner_only/{uuid}-{filename}   readable by the owner only
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('homeos-docs', 'homeos-docs', false)
on conflict (id) do nothing;

create policy docs_storage_read on storage.objects for select using (
  bucket_id = 'homeos-docs'
  and name ~ '^[0-9a-fA-F-]{36}/(family|owner_only)/'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
      and p.family_id = (storage.foldername(name))[1]::uuid
  )
  and (
    (storage.foldername(name))[2] = 'family'
    or public.is_family_owner((storage.foldername(name))[1]::uuid)
  )
);

create policy docs_storage_write on storage.objects for insert with check (
  bucket_id = 'homeos-docs'
  and name ~ '^[0-9a-fA-F-]{36}/(family|owner_only)/'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
      and p.family_id = (storage.foldername(name))[1]::uuid
  )
  and (
    (storage.foldername(name))[2] = 'family'
    or public.is_family_owner((storage.foldername(name))[1]::uuid)
  )
);

create policy docs_storage_delete on storage.objects for delete using (
  bucket_id = 'homeos-docs'
  and name ~ '^[0-9a-fA-F-]{36}/(family|owner_only)/'
  and public.is_family_owner((storage.foldername(name))[1]::uuid)
);

-- ---------------------------------------------------------------------------
-- Per-user notification settings: kinds jsonb maps kind -> 'off' (default on)
-- ---------------------------------------------------------------------------
create table public.notification_settings (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  kinds jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.notification_settings enable row level security;

create policy notification_settings_select on public.notification_settings for select
  using (profile_id = auth.uid());

create policy notification_settings_upsert on public.notification_settings for insert
  with check (profile_id = auth.uid());

create policy notification_settings_update on public.notification_settings for update
  using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- notify(): the only client-callable way to create a notification.
-- Family-scoped, never notifies the actor, honors recipient settings.
-- ---------------------------------------------------------------------------
create or replace function public.notify(
  p_profile_id uuid, p_kind text, p_title text, p_body text default ''
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_target public.profiles%rowtype;
begin
  if p_profile_id = auth.uid() then return; end if;
  select * into v_target from public.profiles where id = p_profile_id;
  if not found then return; end if;
  if not public.is_family_member(v_target.family_id) then
    raise exception 'not allowed';
  end if;
  if exists (
    select 1 from public.notification_settings ns
    where ns.profile_id = p_profile_id and ns.kinds ->> p_kind = 'off'
  ) then return; end if;
  insert into public.notifications (profile_id, family_id, kind, title, body)
  values (p_profile_id, v_target.family_id, p_kind, p_title, p_body);
end;
$$;

-- Invitation acceptance notifies the owner.
create or replace function public.accept_invitation(p_code text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invitations%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_inv from public.invitations
  where code_hash = encode(digest(upper(trim(p_code)), 'sha256'), 'hex')
  for update;
  if not found then raise exception 'invalid invitation code'; end if;
  if v_inv.status = 'pending' and v_inv.expires_at < now() then
    update public.invitations set status = 'expired' where id = v_inv.id;
    raise exception 'invitation expired';
  end if;
  if v_inv.status <> 'pending' then raise exception 'invitation already used or revoked'; end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'profile already exists';
  end if;
  insert into public.profiles (id, family_id, full_name, role, status)
  values (auth.uid(), v_inv.family_id, p_full_name, 'member', 'active');
  update public.invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_inv.id;
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id, metadata)
  values (v_inv.family_id, auth.uid(), 'invitation.accept', 'invitations', v_inv.id::text,
          jsonb_build_object('name', p_full_name));
  insert into public.notifications (profile_id, family_id, kind, title, body)
  select pr.id, v_inv.family_id, 'invitation', 'Invitation accepted', p_full_name || ' joined the family'
  from public.profiles pr
  where pr.family_id = v_inv.family_id and pr.role = 'owner' and pr.status = 'active';
  return auth.uid();
end;
$$;

select 'HOME OS ULTIMATE: database ready ✅' as status,
       (select count(*) from pg_tables where schemaname = 'public') as tables,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public') as functions;
