-- HOME OS PART 20 OF 34
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
