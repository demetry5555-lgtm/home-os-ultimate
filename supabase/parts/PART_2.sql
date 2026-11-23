-- HOME OS PART 2 OF 11 (part 9B is the repair for part 9; part 11 fixes invitation codes)
-- Mirrors the hosted setup page exactly. Hardened: safe to re-run any part.

-- HOME OS PART 2 OF 9
create table if not exists public.finishing_stages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  stage text not null,
  status text not null default 'planned' check (status in ('planned','in_progress','done')),
  cost numeric(14,2) check (cost is null or cost >= 0),
  unique (room_id, stage)
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  room_id uuid references public.rooms(id),
  name text not null,
  purchased_at date,
  value numeric(14,2) check (value is null or value >= 0)
);

create table if not exists public.maintenance (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  asset_id uuid references public.assets(id),
  title text not null,
  status text not null default 'open' check (status in ('open','scheduled','done')),
  cost numeric(14,2) check (cost is null or cost >= 0),
  scheduled_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Documents and notifications
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  bucket text not null default 'family-docs',  -- storage bucket, private + RLS
  path text not null,                          -- storage object path, never public URL
  title text not null,
  mime_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  created_at timestamptz not null default now(),
  unique (bucket, path)
);

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_profile_unread_idx
  on public.notifications (profile_id) where read_at is null;

-- ============================================================================
-- Helper functions (security definer where they must cross RLS)
-- ============================================================================

-- Is the current user an active member of the given family?
create or replace function public.is_family_member(p_family_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and family_id = p_family_id and status = 'active'
  );
$$;

-- Is the current user the active owner of the given family?
create or replace function public.is_family_owner(p_family_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and family_id = p_family_id
      and role = 'owner' and status = 'active'
  );
$$;

-- Does the current user hold a permission within their family?
create or replace function public.has_permission(p_key text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role = p.role
    where p.id = auth.uid() and p.status = 'active'
      and rp.permission_key = p_key
  );
$$;

-- First-run owner bootstrap: creates the family and makes the caller owner.
-- No hardcoded credentials: the caller is whoever just signed up in Auth.
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
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id)
  values (v_family_id, auth.uid(), 'family.bootstrap', 'families', v_family_id::text);
  return v_family_id;
end;
$$;

-- Create an invitation. Owner only. Returns the plaintext code ONCE;
-- only its sha256 hash and last-4 hint are stored.
create or replace function public.create_invitation(p_intended_name text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
  v_code text;
begin
  select family_id into v_family_id from public.profiles
  where id = auth.uid() and role = 'owner' and status = 'active';
  if v_family_id is null then
    raise exception 'only an active owner can create invitations';
  end if;
  v_code := 'HOME-' ||
            upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 4)) || '-' ||
            upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 4));
  insert into public.invitations
    (family_id, code_hash, code_hint, intended_name, created_by)
  values
    (v_family_id, encode(extensions.digest(v_code, 'sha256'), 'hex'),
     right(v_code, 4), p_intended_name, auth.uid());
  insert into public.audit_logs (family_id, actor_id, action, entity, metadata)
  values (v_family_id, auth.uid(), 'invitation.create', 'invitations',
          jsonb_build_object('hint', right(v_code, 4)));
  return v_code;
end;
$$;

-- Accept an invitation with its code. Atomic: claim + profile join in one
-- transaction; the code is single-use and expires.
create or replace function public.accept_invitation(p_code text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'profile already exists';
  end if;
  select * into v_inv from public.invitations
  where code_hash = encode(extensions.digest(upper(trim(p_code)), 'sha256'), 'hex')
  for update;                                    -- lock the row: single-use
  if not found then
    raise exception 'invalid invitation code';
  end if;
  if v_inv.status = 'pending' and v_inv.expires_at < now() then
    update public.invitations set status = 'expired' where id = v_inv.id;
    raise exception 'invitation expired';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'invitation already used or revoked';
  end if;
  insert into public.profiles (id, full_name, family_id, role)
  values (auth.uid(), p_full_name, v_inv.family_id, 'member');
  update public.invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_inv.id;
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id)
  values (v_inv.family_id, auth.uid(), 'invitation.accept', 'invitations', v_inv.id::text);
  return v_inv.family_id;
end;
$$;

-- Revoke an invitation (owner of its family only, and only while pending).
create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
begin
  select family_id into v_family_id from public.invitations where id = p_invitation_id;
  if v_family_id is null or not public.is_family_owner(v_family_id) then
    raise exception 'not allowed';
  end if;
  update public.invitations set status = 'revoked'
  where id = p_invitation_id and status = 'pending';
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id)
  values (v_family_id, auth.uid(), 'invitation.revoke', 'invitations', p_invitation_id::text);
end;
$$;

-- Suspend or reactivate a member (owner only; cannot suspend an owner).
create or replace function public.set_member_status(p_profile_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target public.profiles%rowtype;
begin
  select * into v_target from public.profiles where id = p_profile_id;
  if not found or not public.is_family_owner(v_target.family_id) then
    raise exception 'not allowed';
  end if;
  if v_target.role = 'owner' then
    raise exception 'cannot suspend the owner';
  end if;
  if p_status not in ('active','suspended') then
    raise exception 'invalid status';
  end if;
  update public.profiles set status = p_status where id = p_profile_id;
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id, metadata)
  values (v_target.family_id, auth.uid(), 'member.status', 'profiles',
          p_profile_id::text, jsonb_build_object('status', p_status));
end;
$$;
