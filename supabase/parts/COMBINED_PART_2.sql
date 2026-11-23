-- HOME OS PART 2 OF 7
-- Run only after part 1 has completed successfully.

-- ---------------------------------------------------------------------------
-- Requests and tasks
-- ---------------------------------------------------------------------------
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  requester_id uuid not null references public.profiles(id),
  title text not null check (char_length(title) between 1 and 200),
  details text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint requests_decision_fields check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_by is not null and decided_at is not null)
  )
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  assignee_id uuid references public.profiles(id),
  status text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  due_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  created_by uuid not null references public.profiles(id),
  check (ends_at is null or ends_at > starts_at)
);

-- ---------------------------------------------------------------------------
-- Apartment
-- ---------------------------------------------------------------------------
create table public.apartments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  address text,
  created_at timestamptz not null default now(),
  unique (family_id)                          -- one apartment per family for now
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references public.apartments(id) on delete cascade,
  name text not null,
  floor smallint not null default 0,
  unique (apartment_id, name)
);

create table public.finishing_stages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  stage text not null,
  status text not null default 'planned' check (status in ('planned','in_progress','done')),
  cost numeric(14,2) check (cost is null or cost >= 0),
  unique (room_id, stage)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  room_id uuid references public.rooms(id),
  name text not null,
  purchased_at date,
  value numeric(14,2) check (value is null or value >= 0)
);

create table public.maintenance (
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
create table public.documents (
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

create table public.notifications (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_profile_unread_idx
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
            upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 4)) || '-' ||
            upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 4));
  insert into public.invitations
    (family_id, code_hash, code_hint, intended_name, created_by)
  values
    (v_family_id, encode(digest(v_code, 'sha256'), 'hex'),
     right(v_code, 4), p_intended_name, auth.uid());
  insert into public.audit_logs (family_id, actor_id, action, entity, metadata)
  values (v_family_id, auth.uid(), 'invitation.create', 'invitations',
          jsonb_build_object('hint', right(v_code, 4)));
  return v_code;
end;
$$;
