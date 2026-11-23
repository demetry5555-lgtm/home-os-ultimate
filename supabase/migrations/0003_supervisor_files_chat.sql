-- ============================================================================
-- HOME OS ULTIMATE - Stage 2b: supervisor role, owner-only personal files,
-- family chat room schema.
-- ============================================================================

-- Roles: owner / supervisor / member
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner','supervisor','member'));

alter table public.role_permissions drop constraint role_permissions_role_check;
alter table public.role_permissions add constraint role_permissions_role_check
  check (role in ('owner','supervisor','member'));

-- Supervisor grants: approve/reject requests, add expenses (finance.manage),
-- tasks; NOT family/invitation/member administration and NOT salaries.
insert into public.role_permissions (role, permission_key) values
  ('supervisor', 'finance.view'),
  ('supervisor', 'finance.manage'),
  ('supervisor', 'requests.create'),
  ('supervisor', 'requests.decide'),
  ('supervisor', 'tasks.manage');

-- Owner appoints / demotes supervisors. Owner role itself is immutable.
create or replace function public.set_member_role(p_profile_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target public.profiles%rowtype;
begin
  select * into v_target from public.profiles where id = p_profile_id;
  if not found or not public.is_family_owner(v_target.family_id) then
    raise exception 'not allowed';
  end if;
  if v_target.role = 'owner' then
    raise exception 'cannot change the owner role';
  end if;
  if p_role not in ('member','supervisor') then
    raise exception 'invalid role';
  end if;
  update public.profiles set role = p_role where id = p_profile_id;
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id, metadata)
  values (v_target.family_id, auth.uid(), 'member.role', 'profiles',
          p_profile_id::text, jsonb_build_object('role', p_role));
end;
$$;

-- ---------------------------------------------------------------------------
-- Personal files: each member's private files/data, visible to the OWNER only.
-- visibility = 'owner_only' (default, the sensitive store) or 'family'.
-- ---------------------------------------------------------------------------
alter table public.documents
  add column visibility text not null default 'owner_only'
    check (visibility in ('owner_only','family')),
  add column subject_profile_id uuid references public.profiles(id);

drop policy documents_select on public.documents;
create policy documents_select on public.documents for select
  using (
    public.is_family_owner(family_id)
    or (visibility = 'family' and public.is_family_member(family_id))
  );

-- ---------------------------------------------------------------------------
-- Chat: one family room per family + private 1:1 threads between members.
-- ---------------------------------------------------------------------------
create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  kind text not null check (kind in ('family','direct')),
  -- direct threads: sorted pair "uidA:uidB" makes the pair unique per family
  direct_key text,
  created_at timestamptz not null default now(),
  check ((kind = 'family' and direct_key is null) or (kind = 'direct' and direct_key is not null))
);
create unique index chat_threads_family_room_uq on public.chat_threads (family_id) where kind = 'family';
create unique index chat_threads_direct_uq on public.chat_threads (family_id, direct_key) where kind = 'direct';

create table public.chat_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index chat_messages_thread_idx on public.chat_messages (thread_id, created_at);

-- Thread access: family room -> any active family member; direct -> the pair only.
create or replace function public.can_read_thread(p_thread_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.chat_threads ct
    where ct.id = p_thread_id and (
      (ct.kind = 'family' and public.is_family_member(ct.family_id))
      or (ct.kind = 'direct'
          and public.is_family_member(ct.family_id)
          and (':' || ct.direct_key || ':') like '%:' || auth.uid()::text || ':%')
    )
  );
$$;

-- Open (or get) the private thread between the caller and another member.
create or replace function public.open_direct_thread(p_other_profile_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_other public.profiles%rowtype;
  v_me public.profiles%rowtype;
  v_key text;
  v_thread uuid;
begin
  select * into v_me from public.profiles where id = auth.uid() and status = 'active';
  select * into v_other from public.profiles where id = p_other_profile_id and status = 'active';
  if v_me.id is null or v_other.id is null or v_me.family_id is distinct from v_other.family_id then
    raise exception 'not allowed';
  end if;
  if v_me.id = v_other.id then
    raise exception 'cannot open a thread with yourself';
  end if;
  v_key := least(v_me.id::text, v_other.id::text) || ':' || greatest(v_me.id::text, v_other.id::text);
  insert into public.chat_threads (family_id, kind, direct_key)
  values (v_me.family_id, 'direct', v_key)
  on conflict (family_id, direct_key) where kind = 'direct' do nothing;
  select id into v_thread from public.chat_threads
  where family_id = v_me.family_id and kind = 'direct' and direct_key = v_key;
  return v_thread;
end;
$$;

-- The family room is created with the family.
create or replace function public.bootstrap_owner(p_owner_name text, p_family_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'profile already exists';
  end if;
  insert into public.profiles (id, full_name, role)
  values (auth.uid(), p_owner_name, 'owner');
  insert into public.families (name, owner_id) values (p_family_name, auth.uid())
  returning id into v_family_id;
  update public.profiles set family_id = v_family_id where id = auth.uid();
  insert into public.chat_threads (family_id, kind) values (v_family_id, 'family');
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id)
  values (v_family_id, auth.uid(), 'family.bootstrap', 'families', v_family_id::text);
  return v_family_id;
end;
$$;

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

create policy chat_threads_select on public.chat_threads for select
  using (public.can_read_thread(id));
create policy chat_messages_select on public.chat_messages for select
  using (public.can_read_thread(thread_id));
create policy chat_messages_insert on public.chat_messages for insert
  with check (public.can_read_thread(thread_id) and sender_id = auth.uid());
