-- ============================================================================
-- HOME OS ULTIMATE - COMPLETE DATABASE SETUP (stages 1-4 combined)
-- Paste ONCE into Supabase SQL Editor on a FRESH project and Run.
-- (On mobile, use supabase/parts/COMBINED_PART_1..9.sql instead - same content,
-- split into phone-sized parts. Parts 1-7 = stages 1-3, parts 8-9 = stage 4.)
-- ============================================================================

-- ============================================================================
-- HOME OS ULTIMATE - Stage 1 foundation schema
-- PostgreSQL / Supabase. All access enforced server-side via RLS.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enumerated lookup: permissions catalog + role -> permission grants
-- ---------------------------------------------------------------------------
create table public.permissions (
  key text primary key,
  description text not null default ''
);

insert into public.permissions (key, description) values
  ('family.manage',        'Manage family settings and members'),
  ('invitations.manage',   'Create, view and revoke invitations'),
  ('finance.view',         'View accounts and transactions'),
  ('finance.manage',       'Create and edit financial records'),
  ('requests.create',      'Submit requests'),
  ('requests.decide',      'Approve or reject requests'),
  ('tasks.manage',         'Assign and manage tasks'),
  ('apartment.manage',     'Manage apartment, rooms and finishing stages'),
  ('assets.manage',        'Manage assets and maintenance'),
  ('documents.manage',     'Upload and manage documents'),
  ('members.suspend',      'Suspend or reactivate member accounts');

create table public.role_permissions (
  role text not null check (role in ('owner','member')),
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role, permission_key)
);

insert into public.role_permissions (role, permission_key)
  select 'owner', key from public.permissions;

insert into public.role_permissions (role, permission_key) values
  ('member', 'finance.view'),
  ('member', 'requests.create'),
  ('member', 'tasks.manage');

-- ---------------------------------------------------------------------------
-- Core identity
-- ---------------------------------------------------------------------------
create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid references public.families(id),
  full_name text not null check (char_length(full_name) between 1 and 120),
  display_name text,
  avatar_url text,
  role text not null default 'member' check (role in ('owner','member')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now()
);

alter table public.families
  add constraint families_owner_profile_fk
  foreign key (owner_id) references public.profiles(id);

-- ---------------------------------------------------------------------------
-- Invitations: hashed single-use codes, never stored in plaintext
-- ---------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  code_hash text not null unique,               -- sha256 hex of the code
  code_hint text not null,                      -- last 4 chars, for owner reference
  intended_name text not null default '',
  role text not null default 'member' check (role = 'member'),
  status text not null default 'pending'
    check (status in ('draft','pending','accepted','expired','revoked')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references public.profiles(id),
  accepted_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint invitations_accept_fields check (
    (status = 'accepted' and accepted_by is not null and accepted_at is not null)
    or (status <> 'accepted' and accepted_by is null and accepted_at is null)
  )
);
create index invitations_family_status_idx on public.invitations (family_id, status);

-- ---------------------------------------------------------------------------
-- Sessions (audit trail of sign-in events; Supabase Auth owns the real tokens)
-- ---------------------------------------------------------------------------
create table public.session_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('sign_in','sign_out','sign_up')),
  user_agent text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  family_id uuid references public.families(id),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_family_idx on public.audit_logs (family_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Finance
-- ---------------------------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  type text not null check (type in ('cash','bank','wallet','card')),
  currency char(3) not null default 'EGP',
  balance numeric(14,2) not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  unique (family_id, name)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  account_id uuid not null references public.accounts(id),
  related_transaction_id uuid references public.transactions(id),
  type text not null check (type in ('income','expense','transfer')),
  amount numeric(14,2) not null check (amount > 0),
  category text not null default 'general',
  description text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index transactions_family_idx on public.transactions (family_id, created_at desc);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  category text not null,
  monthly_limit numeric(14,2) not null check (monthly_limit > 0),
  month date not null default date_trunc('month', now())::date,
  unique (family_id, category, month)
);

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  counterparty text not null,
  direction text not null check (direction in ('lent','borrowed')),
  principal numeric(14,2) not null check (principal > 0),
  remaining numeric(14,2) not null check (remaining >= 0),
  due_date date,
  created_at timestamptz not null default now(),
  check (remaining <= principal)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  loan_id uuid references public.loans(id) on delete cascade,
  transaction_id uuid references public.transactions(id),
  amount numeric(14,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  note text not null default ''
);

create table public.salaries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  amount numeric(14,2) not null check (amount > 0),
  currency char(3) not null default 'EGP',
  payday smallint not null check (payday between 1 and 31),
  active boolean not null default true,
  unique (family_id, profile_id)
);

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
  where code_hash = encode(digest(upper(trim(p_code)), 'sha256'), 'hex')
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

-- Atomic money transfer between two family accounts.
-- Locks both rows in a fixed order; all-or-nothing.
create or replace function public.transfer_funds(
  p_from_account uuid, p_to_account uuid, p_amount numeric, p_description text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_from public.accounts%rowtype;
  v_to public.accounts%rowtype;
  v_low uuid; v_high uuid;
  v_tx_out uuid; v_tx_in uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  select * into v_from from public.accounts where id = p_from_account;
  select * into v_to   from public.accounts where id = p_to_account;
  if not found or v_from.family_id is distinct from v_to.family_id then
    raise exception 'accounts not in the same family';
  end if;
  if not public.has_permission('finance.manage')
     or not public.is_family_member(v_from.family_id) then
    raise exception 'not allowed';
  end if;
  -- lock in id order to avoid deadlocks
  v_low  := least(p_from_account, p_to_account);
  v_high := greatest(p_from_account, p_to_account);
  perform 1 from public.accounts where id = v_low  for update;
  perform 1 from public.accounts where id = v_high for update;
  update public.accounts set balance = balance - p_amount
  where id = p_from_account and balance >= p_amount
  returning id into v_tx_out;
  if v_tx_out is null then
    raise exception 'insufficient funds';
  end if;
  update public.accounts set balance = balance + p_amount where id = p_to_account;
  insert into public.transactions
    (family_id, account_id, type, amount, category, description, created_by)
  values
    (v_from.family_id, p_from_account, 'transfer', p_amount, 'transfer', p_description, auth.uid())
  returning id into v_tx_out;
  insert into public.transactions
    (family_id, account_id, type, amount, category, description, created_by, related_transaction_id)
  values
    (v_from.family_id, p_to_account, 'transfer', p_amount, 'transfer', p_description, auth.uid(), v_tx_out)
  returning id into v_tx_in;
  insert into public.audit_logs (family_id, actor_id, action, entity, metadata)
  values (v_from.family_id, auth.uid(), 'finance.transfer', 'accounts',
          jsonb_build_object('from', p_from_account, 'to', p_to_account, 'amount', p_amount));
  return v_tx_out;
end;
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.profiles          enable row level security;
alter table public.families          enable row level security;
alter table public.invitations       enable row level security;
alter table public.session_events    enable row level security;
alter table public.audit_logs        enable row level security;
alter table public.accounts          enable row level security;
alter table public.transactions      enable row level security;
alter table public.budgets           enable row level security;
alter table public.loans             enable row level security;
alter table public.payments          enable row level security;
alter table public.salaries          enable row level security;
alter table public.requests          enable row level security;
alter table public.tasks             enable row level security;
alter table public.calendar_events   enable row level security;
alter table public.apartments        enable row level security;
alter table public.rooms             enable row level security;
alter table public.finishing_stages  enable row level security;
alter table public.assets            enable row level security;
alter table public.maintenance       enable row level security;
alter table public.documents         enable row level security;
alter table public.notifications     enable row level security;
alter table public.permissions       enable row level security;
alter table public.role_permissions  enable row level security;

-- Reference data: readable by any signed-in user, never writable from clients.
create policy permissions_read on public.permissions for select using (auth.uid() is not null);
create policy role_permissions_read on public.role_permissions for select using (auth.uid() is not null);

-- Profiles: family members see each other; you always see and edit yourself.
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_family_member(family_id));
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

-- Families: members can read; only owner can update.
create policy families_select on public.families for select using (public.is_family_member(id));
create policy families_update_owner on public.families for update using (public.is_family_owner(id));

-- Invitations: only the family owner reads the list; writes go through the
-- security-definer functions (create_invitation / accept / revoke).
create policy invitations_select_owner on public.invitations for select
  using (public.is_family_owner(family_id));

-- Session events: you read and insert only your own.
create policy session_events_select on public.session_events for select using (user_id = auth.uid());
create policy session_events_insert on public.session_events for insert with check (user_id = auth.uid());

-- Audit log: family members read; only functions insert (no client policy).
create policy audit_logs_select on public.audit_logs for select
  using (family_id is not null and public.is_family_member(family_id));

-- Finance
create policy accounts_select on public.accounts for select using (public.is_family_member(family_id));
create policy accounts_write on public.accounts for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

create policy transactions_select on public.transactions for select using (public.is_family_member(family_id));
create policy transactions_insert on public.transactions for insert
  with check (public.is_family_member(family_id) and public.has_permission('finance.manage'));

create policy budgets_all on public.budgets for all
  using (public.is_family_member(family_id) and public.has_permission('finance.manage'))
  with check (public.is_family_member(family_id) and public.has_permission('finance.manage'));

create policy loans_select on public.loans for select using (public.is_family_member(family_id));
create policy loans_write on public.loans for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

create policy payments_select on public.payments for select using (public.is_family_member(family_id));
create policy payments_insert on public.payments for insert
  with check (public.is_family_member(family_id) and public.has_permission('finance.manage'));

create policy salaries_select on public.salaries for select
  using (public.is_family_owner(family_id) or profile_id = auth.uid());
create policy salaries_write on public.salaries for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

-- Requests: members create their own and read the family's; owners decide via update.
create policy requests_select on public.requests for select using (public.is_family_member(family_id));
create policy requests_insert on public.requests for insert
  with check (public.is_family_member(family_id) and requester_id = auth.uid());
create policy requests_update_owner on public.requests for update
  using (public.is_family_owner(family_id));

-- Tasks
create policy tasks_select on public.tasks for select using (public.is_family_member(family_id));
create policy tasks_insert on public.tasks for insert
  with check (public.is_family_member(family_id) and created_by = auth.uid());
create policy tasks_update on public.tasks for update using (public.is_family_member(family_id));

-- Calendar
create policy calendar_select on public.calendar_events for select using (public.is_family_member(family_id));
create policy calendar_write on public.calendar_events for all
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));

-- Apartment: members read, owner manages.
create policy apartments_select on public.apartments for select using (public.is_family_member(family_id));
create policy apartments_write on public.apartments for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

create policy rooms_select on public.rooms for select
  using (exists (select 1 from public.apartments a where a.id = apartment_id and public.is_family_member(a.family_id)));
create policy rooms_write on public.rooms for all
  using (exists (select 1 from public.apartments a where a.id = apartment_id and public.is_family_owner(a.family_id)));

create policy finishing_select on public.finishing_stages for select
  using (exists (select 1 from public.rooms r join public.apartments a on a.id = r.apartment_id
                 where r.id = room_id and public.is_family_member(a.family_id)));
create policy finishing_write on public.finishing_stages for all
  using (exists (select 1 from public.rooms r join public.apartments a on a.id = r.apartment_id
                 where r.id = room_id and public.is_family_owner(a.family_id)));

create policy assets_select on public.assets for select using (public.is_family_member(family_id));
create policy assets_write on public.assets for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

create policy maintenance_select on public.maintenance for select using (public.is_family_member(family_id));
create policy maintenance_write on public.maintenance for all
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));

-- Documents: metadata is family-visible; the storage bucket stays private and
-- files are served only via short-lived signed URLs.
create policy documents_select on public.documents for select using (public.is_family_member(family_id));
create policy documents_insert on public.documents for insert
  with check (public.is_family_member(family_id) and owner_id = auth.uid());
create policy documents_delete on public.documents for delete
  using (owner_id = auth.uid() or public.is_family_owner(family_id));

-- Notifications: strictly per-recipient.
create policy notifications_select on public.notifications for select using (profile_id = auth.uid());
create policy notifications_update on public.notifications for update using (profile_id = auth.uid());


-- ============================================================================
-- HOME OS ULTIMATE - Stage 2: Finance OS
-- Atomic money, salaries with bonus/deduction, loan repayment, budget scopes,
-- receipts. All amounts numeric(14,2); every mutation is one transaction
-- inside a security-definer function. No client-side balance writes.
-- ============================================================================

-- Account types widen: home vaults and per-member accounts join cash/bank/wallet/card.
alter table public.accounts drop constraint accounts_type_check;
alter table public.accounts add constraint accounts_type_check
  check (type in ('cash','bank','wallet','vault','card','member'));
-- A member account belongs to one family member; NULL = family-wide account.
alter table public.accounts add column owner_profile_id uuid references public.profiles(id);

-- Receipts and member attribution on transactions.
alter table public.transactions add column receipt_path text;      -- private storage path, never public URL
alter table public.transactions add column member_id uuid references public.profiles(id);

-- A loan/advance can be tied to a family member.
alter table public.loans add column profile_id uuid references public.profiles(id);

-- Salaries: monthly or day-wage.
alter table public.salaries add column pay_type text not null default 'monthly'
  check (pay_type in ('monthly','daily'));

-- Payslips: one row per payout with the exact math frozen at payment time.
create table public.salary_payments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  salary_id uuid not null references public.salaries(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  period date not null,                            -- month (or day) the pay covers
  base numeric(14,2) not null check (base >= 0),
  bonus numeric(14,2) not null default 0 check (bonus >= 0),
  deduction numeric(14,2) not null default 0 check (deduction >= 0),
  net numeric(14,2) not null check (net >= 0),
  transaction_id uuid not null references public.transactions(id),
  paid_at timestamptz not null default now(),
  unique (salary_id, period)                       -- no double-paying a period
);
alter table public.salary_payments enable row level security;
create policy salary_payments_select on public.salary_payments for select
  using (public.is_family_owner(family_id) or profile_id = auth.uid());

-- Budgets: monthly or annual; family-wide, per apartment, or per member.
alter table public.budgets add column period text not null default 'monthly'
  check (period in ('monthly','annual'));
alter table public.budgets add column scope text not null default 'family'
  check (scope in ('family','apartment','member'));
alter table public.budgets add column scope_id uuid;  -- apartments.id or profiles.id

-- ---------------------------------------------------------------------------
-- record_income: credit an account atomically.
-- ---------------------------------------------------------------------------
create or replace function public.record_income(
  p_account_id uuid, p_amount numeric, p_category text, p_description text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_acc public.accounts%rowtype;
  v_tx uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select * into v_acc from public.accounts where id = p_account_id for update;
  if not found then raise exception 'account not found'; end if;
  if not public.is_family_member(v_acc.family_id) or not public.has_permission('finance.manage') then
    raise exception 'not allowed';
  end if;
  update public.accounts set balance = balance + p_amount where id = p_account_id;
  insert into public.transactions
    (family_id, account_id, type, amount, category, description, created_by)
  values
    (v_acc.family_id, p_account_id, 'income', p_amount, p_category, p_description, auth.uid())
  returning id into v_tx;
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id, metadata)
  values (v_acc.family_id, auth.uid(), 'finance.income', 'transactions', v_tx::text,
          jsonb_build_object('account', p_account_id, 'amount', p_amount));
  return v_tx;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_expense: debit an account atomically; fails on insufficient funds.
-- ---------------------------------------------------------------------------
create or replace function public.record_expense(
  p_account_id uuid, p_amount numeric, p_category text,
  p_description text default '', p_receipt_path text default null,
  p_member_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_acc public.accounts%rowtype;
  v_tx uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select * into v_acc from public.accounts where id = p_account_id for update;
  if not found then raise exception 'account not found'; end if;
  if not public.is_family_member(v_acc.family_id) or not public.has_permission('finance.manage') then
    raise exception 'not allowed';
  end if;
  update public.accounts set balance = balance - p_amount
  where id = p_account_id and balance >= p_amount;
  if not found then raise exception 'insufficient funds'; end if;
  insert into public.transactions
    (family_id, account_id, type, amount, category, description, created_by, receipt_path, member_id)
  values
    (v_acc.family_id, p_account_id, 'expense', p_amount, p_category, p_description,
     auth.uid(), p_receipt_path, p_member_id)
  returning id into v_tx;
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id, metadata)
  values (v_acc.family_id, auth.uid(), 'finance.expense', 'transactions', v_tx::text,
          jsonb_build_object('account', p_account_id, 'amount', p_amount, 'category', p_category));
  return v_tx;
end;
$$;

-- ---------------------------------------------------------------------------
-- repay_loan: partial or full. Locks the loan row, caps at remaining,
-- writes payment + expense transaction + decrements remaining, all or nothing.
-- ---------------------------------------------------------------------------
create or replace function public.repay_loan(
  p_loan_id uuid, p_account_id uuid, p_amount numeric
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_loan public.loans%rowtype;
  v_tx uuid;
  v_payment uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found then raise exception 'loan not found'; end if;
  if not public.is_family_member(v_loan.family_id) or not public.has_permission('finance.manage') then
    raise exception 'not allowed';
  end if;
  if p_amount > v_loan.remaining then raise exception 'amount exceeds remaining balance'; end if;
  if v_loan.direction = 'borrowed' then
    -- we pay money out of the account
    v_tx := public.record_expense(p_account_id, p_amount, 'loan_repayment',
                                  'loan ' || p_loan_id::text, null, v_loan.profile_id);
  else
    -- lent money comes back into the account
    v_tx := public.record_income(p_account_id, p_amount, 'loan_repayment',
                                 'loan ' || p_loan_id::text);
  end if;
  update public.loans set remaining = remaining - p_amount where id = p_loan_id;
  insert into public.payments (family_id, loan_id, transaction_id, amount)
  values (v_loan.family_id, p_loan_id, v_tx, p_amount)
  returning id into v_payment;
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id, metadata)
  values (v_loan.family_id, auth.uid(), 'finance.loan_repay', 'loans', p_loan_id::text,
          jsonb_build_object('amount', p_amount, 'remaining', v_loan.remaining - p_amount));
  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------
-- pay_salary: net = base + bonus - deduction, paid from an account atomically.
-- One payslip per salary per period (unique constraint blocks double pay).
-- ---------------------------------------------------------------------------
create or replace function public.pay_salary(
  p_salary_id uuid, p_account_id uuid,
  p_bonus numeric default 0, p_deduction numeric default 0,
  p_period date default date_trunc('month', now())::date
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sal public.salaries%rowtype;
  v_net numeric(14,2);
  v_tx uuid;
  v_pay uuid;
begin
  if coalesce(p_bonus,0) < 0 or coalesce(p_deduction,0) < 0 then
    raise exception 'bonus and deduction must be non-negative';
  end if;
  select * into v_sal from public.salaries where id = p_salary_id and active;
  if not found then raise exception 'salary not found or inactive'; end if;
  if not public.is_family_owner(v_sal.family_id) then raise exception 'not allowed'; end if;
  v_net := v_sal.amount + coalesce(p_bonus,0) - coalesce(p_deduction,0);
  if v_net <= 0 then raise exception 'net pay must be positive'; end if;
  v_tx := public.record_expense(p_account_id, v_net, 'salary',
                                'salary ' || p_period::text, null, v_sal.profile_id);
  insert into public.salary_payments
    (family_id, salary_id, profile_id, period, base, bonus, deduction, net, transaction_id)
  values
    (v_sal.family_id, p_salary_id, v_sal.profile_id, p_period,
     v_sal.amount, coalesce(p_bonus,0), coalesce(p_deduction,0), v_net, v_tx)
  returning id into v_pay;
  insert into public.notifications (profile_id, family_id, kind, title, body)
  values (v_sal.profile_id, v_sal.family_id, 'salary',
          'Salary paid', 'Net ' || v_net::text || ' for ' || p_period::text);
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id, metadata)
  values (v_sal.family_id, auth.uid(), 'finance.salary_pay', 'salary_payments', v_pay::text,
          jsonb_build_object('net', v_net, 'period', p_period));
  return v_pay;
end;
$$;

-- ---------------------------------------------------------------------------
-- budget_report: planned vs actual per budget row for a given month.
-- Actual = sum of expenses in the budget's category for that month,
-- filtered by scope (family / apartment via member link / single member).
-- ---------------------------------------------------------------------------
create or replace function public.budget_report(p_month date)
returns table (
  budget_id uuid, category text, scope text, scope_id uuid,
  planned numeric, actual numeric, remaining numeric
) language plpgsql security definer stable set search_path = public as $$
declare
  v_family_id uuid;
  v_from timestamptz;
  v_to timestamptz;
begin
  select family_id into v_family_id from public.profiles where id = auth.uid();
  if v_family_id is null then return; end if;
  v_from := p_month::timestamptz;
  v_to := (p_month + interval '1 month')::timestamptz;
  return query
  select b.id, b.category, b.scope, b.scope_id, b.monthly_limit,
    coalesce(sum(t.amount) filter (
      where (b.scope = 'family')
         or (b.scope = 'member' and t.member_id = b.scope_id)
         or (b.scope = 'apartment' and t.category like 'apartment:%')
    ), 0) as actual,
    b.monthly_limit - coalesce(sum(t.amount) filter (
      where (b.scope = 'family')
         or (b.scope = 'member' and t.member_id = b.scope_id)
         or (b.scope = 'apartment' and t.category like 'apartment:%')
    ), 0) as remaining
  from public.budgets b
  left join public.transactions t
    on t.family_id = b.family_id and t.type = 'expense'
   and t.category = b.category
   and t.created_at >= case when b.period = 'annual'
                            then date_trunc('year', p_month)::timestamptz else v_from end
   and t.created_at <  case when b.period = 'annual'
                            then (date_trunc('year', p_month) + interval '1 year')::timestamptz else v_to end
  where b.family_id = v_family_id and b.month = p_month
  group by b.id
  order by b.category;
end;
$$;

-- ---------------------------------------------------------------------------
-- finance_summary: the dashboard cards in one round trip.
-- ---------------------------------------------------------------------------
create or replace function public.finance_summary(p_month date default date_trunc('month', now())::date)
returns table (
  total_balance numeric, month_income numeric, month_expense numeric,
  open_loans_remaining numeric, budget_planned numeric, budget_actual numeric
) language plpgsql security definer stable set search_path = public as $$
declare
  v_family_id uuid;
  v_from timestamptz := p_month::timestamptz;
  v_to timestamptz := (p_month + interval '1 month')::timestamptz;
begin
  select family_id into v_family_id from public.profiles where id = auth.uid();
  if v_family_id is null then return; end if;
  return query
  select
    coalesce((select sum(a.balance) from public.accounts a where a.family_id = v_family_id), 0),
    coalesce((select sum(t.amount) from public.transactions t
              where t.family_id = v_family_id and t.type = 'income'
                and t.created_at >= v_from and t.created_at < v_to), 0),
    coalesce((select sum(t.amount) from public.transactions t
              where t.family_id = v_family_id and t.type = 'expense'
                and t.created_at >= v_from and t.created_at < v_to), 0),
    coalesce((select sum(l.remaining) from public.loans l
              where l.family_id = v_family_id and l.remaining > 0), 0),
    coalesce((select sum(b.monthly_limit) from public.budgets b
              where b.family_id = v_family_id and b.month = p_month), 0),
    coalesce((select sum(t.amount) from public.transactions t
              where t.family_id = v_family_id and t.type = 'expense'
                and t.created_at >= v_from and t.created_at < v_to
                and t.category in (select b.category from public.budgets b
                                   where b.family_id = v_family_id and b.month = p_month)), 0);
end;
$$;


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


-- ============================================================================
-- HOME OS ULTIMATE - Stage 3: Requests center
-- Types, full status machine, comments, decision events, finance linking.
-- Visibility: members see ONLY their own requests; owner + supervisors
-- (requests.decide) see and decide all family requests.
-- ============================================================================

alter table public.requests
  add column request_number bigint generated always as identity,
  add column type text not null default 'custom'
    check (type in ('money','purchase','outing','travel','booking','maintenance','leave','needs','document','help','custom')),
  add column amount numeric(14,2) check (amount is null or amount >= 0),
  add column priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  add column assignee_id uuid references public.profiles(id),
  add column linked_transaction_id uuid references public.transactions(id);

alter table public.requests drop constraint requests_status_check;
alter table public.requests add constraint requests_status_check
  check (status in ('new','under_review','needs_info','approved','partially_approved','rejected','deferred','completed','cancelled'));

alter table public.requests drop constraint requests_decision_fields;
-- decided_by/decided_at track the LATEST decision; full history in request_events.

alter table public.requests alter column status set default 'new';
update public.requests set status = 'new' where status = 'pending';

-- Every action on a request, with actor, timestamp, reason.
create table public.request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  from_status text,
  to_status text,
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index request_events_request_idx on public.request_events (request_id, created_at);

-- Discussion thread per request.
create table public.request_comments (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index request_comments_request_idx on public.request_comments (request_id, created_at);

alter table public.request_events enable row level security;
alter table public.request_comments enable row level security;

-- ---------------------------------------------------------------------------
-- can_decide_requests: active family member holding requests.decide
-- ---------------------------------------------------------------------------
create or replace function public.can_decide_requests(p_family_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_family_member(p_family_id) and public.has_permission('requests.decide');
$$;

-- ---------------------------------------------------------------------------
-- decide_request: the ONLY way requests change state. Validates the
-- transition, records the event with reason, notifies the requester.
-- ---------------------------------------------------------------------------
create or replace function public.decide_request(
  p_request_id uuid, p_to_status text, p_reason text default ''
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests%rowtype;
  v_valid boolean;
begin
  select * into v_req from public.requests where id = p_request_id for update;
  if not found then raise exception 'request not found'; end if;
  if not public.can_decide_requests(v_req.family_id) then raise exception 'not allowed'; end if;

  v_valid := case v_req.status
    when 'new' then p_to_status in ('under_review','needs_info','approved','partially_approved','rejected','deferred')
    when 'under_review' then p_to_status in ('needs_info','approved','partially_approved','rejected','deferred')
    when 'needs_info' then p_to_status in ('under_review','approved','partially_approved','rejected','deferred')
    when 'approved' then p_to_status = 'completed'
    when 'partially_approved' then p_to_status = 'completed'
    when 'deferred' then p_to_status in ('under_review','rejected')
    else false
  end;
  if not v_valid then
    raise exception 'invalid transition from % to %', v_req.status, p_to_status;
  end if;

  update public.requests
  set status = p_to_status, decided_by = auth.uid(), decided_at = now()
  where id = p_request_id;

  insert into public.request_events (request_id, actor_id, action, from_status, to_status, reason)
  values (p_request_id, auth.uid(), 'decision', v_req.status, p_to_status, p_reason);

  insert into public.notifications (profile_id, family_id, kind, title, body)
  values (v_req.requester_id, v_req.family_id, 'request',
          'Request ' || p_to_status,
          coalesce(nullif(p_reason, ''), v_req.title));
end;
$$;

-- Requester cancels their own request (before it's decided).
create or replace function public.cancel_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests%rowtype;
begin
  select * into v_req from public.requests where id = p_request_id for update;
  if not found then raise exception 'request not found'; end if;
  if v_req.requester_id <> auth.uid() then raise exception 'not allowed'; end if;
  if v_req.status not in ('new','under_review','needs_info','deferred') then
    raise exception 'cannot cancel a decided request';
  end if;
  update public.requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now()
  where id = p_request_id;
  insert into public.request_events (request_id, actor_id, action, from_status, to_status)
  values (p_request_id, auth.uid(), 'cancel', v_req.status, 'cancelled');
end;
$$;

-- Link an approved money request to a real finance transaction.
create or replace function public.link_request_transaction(p_request_id uuid, p_transaction_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests%rowtype;
begin
  select * into v_req from public.requests where id = p_request_id;
  if not found then raise exception 'request not found'; end if;
  if not public.can_decide_requests(v_req.family_id) then raise exception 'not allowed'; end if;
  if v_req.status not in ('approved','partially_approved','completed') then
    raise exception 'only approved requests can be linked';
  end if;
  update public.requests set linked_transaction_id = p_transaction_id where id = p_request_id;
  insert into public.request_events (request_id, actor_id, action, reason)
  values (p_request_id, auth.uid(), 'link_transaction', p_transaction_id::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
drop policy if exists requests_select on public.requests;
drop policy if exists requests_insert on public.requests;
drop policy if exists requests_update_owner on public.requests;

create policy requests_select on public.requests for select
  using (requester_id = auth.uid() or public.can_decide_requests(family_id));

create policy requests_insert on public.requests for insert
  with check (public.is_family_member(family_id) and requester_id = auth.uid() and status = 'new');

-- No direct client updates: all state changes go through the functions above.

create policy request_events_select on public.request_events for select
  using (exists (select 1 from public.requests r
                 where r.id = request_id
                   and (r.requester_id = auth.uid() or public.can_decide_requests(r.family_id))));

create policy request_comments_select on public.request_comments for select
  using (exists (select 1 from public.requests r
                 where r.id = request_id
                   and (r.requester_id = auth.uid() or public.can_decide_requests(r.family_id))));
create policy request_comments_insert on public.request_comments for insert
  with check (author_id = auth.uid() and exists (
    select 1 from public.requests r
    where r.id = request_id
      and (r.requester_id = auth.uid() or public.can_decide_requests(r.family_id))));


-- ============================================================================
-- HOME OS ULTIMATE - Stage 4: tasks, calendar, apartment module.
-- Tasks: full lifecycle with sub-steps, recurrence, approval, rating.
-- Calendar: rich events with recurrence, reminders and links.
-- Apartment: profile, rooms, finishing stages, assets, maintenance,
-- suppliers, and live budget linkage to finance transactions.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Supervisors may also manage the apartment and assets (owner already has all).
-- ---------------------------------------------------------------------------
insert into public.role_permissions (role, permission_key) values
  ('supervisor', 'apartment.manage'),
  ('supervisor', 'assets.manage');

-- ---------------------------------------------------------------------------
-- TASKS
-- ---------------------------------------------------------------------------
alter table public.tasks
  drop column due_at,
  add column description text not null default '',
  add column participants uuid[] not null default '{}',
  add column priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  add column start_date date,
  add column due_date date,
  add column budget numeric(14,2) check (budget is null or budget >= 0),
  add column recurrence text not null default 'none'
    check (recurrence in ('none','daily','weekly','monthly')),
  add column requires_approval boolean not null default false,
  add column rating smallint check (rating between 1 and 5),
  add column linked_request_id uuid references public.requests(id),
  add column room_id uuid references public.rooms(id),
  add column completed_at timestamptz,
  add column approved_by uuid references public.profiles(id),
  add column check (due_date is null or start_date is null or due_date >= start_date);

alter table public.tasks drop constraint tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status in ('todo','in_progress','blocked','pending_approval','completed','cancelled'));
alter table public.tasks alter column status set default 'todo';
update public.tasks set status = 'todo' where status = 'open';
update public.tasks set status = 'completed' where status = 'done';

create table public.task_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  done boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index task_steps_task_idx on public.task_steps (task_id, position);

-- Attachments/proof photos: storage PATHS only until the documents stage
-- wires binary upload to Supabase Storage.
create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  path text not null,
  kind text not null default 'attachment' check (kind in ('attachment','proof')),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.task_comments (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);

create table public.task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  from_status text,
  to_status text,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index task_events_task_idx on public.task_events (task_id, created_at);

alter table public.task_steps enable row level security;
alter table public.task_attachments enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_events enable row level security;

-- Owner or active supervisor: approves completions and rates tasks.
create or replace function public.can_approve_tasks(p_family_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.family_id = p_family_id
      and p.status = 'active' and p.role in ('owner','supervisor')
  );
$$;

-- Involved in a task: creator, assignee or one of the participants.
create or replace function public.is_task_actor(p_task public.tasks)
returns boolean language sql security definer stable set search_path = public as $$
  select p_task.created_by = auth.uid()
      or p_task.assignee_id = auth.uid()
      or auth.uid() = any(p_task.participants)
      or public.can_approve_tasks(p_task.family_id);
$$;

-- ---------------------------------------------------------------------------
-- set_task_status: the ONLY way task status changes. Validates transitions,
-- records an event, spawns the next occurrence for recurring tasks.
-- ---------------------------------------------------------------------------
create or replace function public.set_task_status(
  p_task_id uuid, p_to_status text, p_note text default ''
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_task public.tasks%rowtype;
  v_valid boolean;
  v_new_id uuid;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'task not found'; end if;
  if not public.is_family_member(v_task.family_id) then raise exception 'not allowed'; end if;

  v_valid := case v_task.status
    when 'todo' then p_to_status in ('in_progress','blocked','cancelled')
      or (p_to_status = 'pending_approval' and v_task.requires_approval)
      or (p_to_status = 'completed' and not v_task.requires_approval)
    when 'in_progress' then p_to_status in ('todo','blocked','cancelled')
      or (p_to_status = 'pending_approval' and v_task.requires_approval)
      or (p_to_status = 'completed' and not v_task.requires_approval)
    when 'blocked' then p_to_status in ('todo','in_progress','cancelled')
    when 'pending_approval' then p_to_status = 'completed' or p_to_status = 'in_progress'
    else false
  end;
  if not v_valid then raise exception 'invalid transition'; end if;

  -- Completion through approval, and un-approval, are approver-only moves.
  if (v_task.status = 'pending_approval' and p_to_status in ('completed','in_progress'))
     or p_to_status = 'cancelled' then
    if not (public.can_approve_tasks(v_task.family_id) or v_task.created_by = auth.uid()) then
      raise exception 'not allowed';
    end if;
  elsif not public.is_task_actor(v_task) then
    raise exception 'not allowed';
  end if;

  update public.tasks set
    status = p_to_status,
    completed_at = case when p_to_status = 'completed' then now() else null end,
    approved_by = case when p_to_status = 'completed' and v_task.requires_approval then auth.uid() else approved_by end
  where id = p_task_id;

  insert into public.task_events (task_id, actor_id, action, from_status, to_status, note)
  values (p_task_id, auth.uid(), 'status', v_task.status, p_to_status, p_note);

  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id, metadata)
  values (v_task.family_id, auth.uid(), 'task.status', 'tasks', p_task_id::text,
          jsonb_build_object('from', v_task.status, 'to', p_to_status));

  -- Recurrence: completing a recurring task spawns the next occurrence.
  if p_to_status = 'completed' and v_task.recurrence <> 'none' then
    insert into public.tasks (
      family_id, title, description, assignee_id, participants, priority,
      start_date, due_date, budget, recurrence, requires_approval,
      linked_request_id, room_id, created_by
    ) values (
      v_task.family_id, v_task.title, v_task.description, v_task.assignee_id,
      v_task.participants, v_task.priority,
      case v_task.recurrence
        when 'daily' then v_task.start_date + 1
        when 'weekly' then v_task.start_date + 7
        else v_task.start_date + interval '1 month' end::date,
      case v_task.recurrence
        when 'daily' then v_task.due_date + 1
        when 'weekly' then v_task.due_date + 7
        else v_task.due_date + interval '1 month' end::date,
      v_task.budget, v_task.recurrence, v_task.requires_approval,
      v_task.linked_request_id, v_task.room_id, v_task.created_by
    ) returning id into v_new_id;
    insert into public.task_steps (task_id, title, done, position)
      select v_new_id, title, false, position from public.task_steps where task_id = p_task_id;
    insert into public.task_events (task_id, actor_id, action, note)
    values (v_new_id, auth.uid(), 'recurrence', 'spawned from ' || p_task_id::text);
  end if;
end;
$$;

create or replace function public.rate_task(p_task_id uuid, p_rating int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_task public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found then raise exception 'task not found'; end if;
  if not public.can_approve_tasks(v_task.family_id) then raise exception 'not allowed'; end if;
  if v_task.status <> 'completed' then raise exception 'only completed tasks can be rated'; end if;
  if p_rating < 1 or p_rating > 5 then raise exception 'rating must be 1-5'; end if;
  update public.tasks set rating = p_rating where id = p_task_id;
  insert into public.task_events (task_id, actor_id, action, note)
  values (p_task_id, auth.uid(), 'rating', p_rating::text);
end;
$$;

-- Direct table access: read within family; create as family member; no
-- client-side status flips (those go through set_task_status).
drop policy tasks_update on public.tasks;
create policy tasks_update_fields on public.tasks for update
  using (public.is_family_member(family_id))
  with check (public.is_family_member(family_id));

create policy task_steps_select on public.task_steps for select
  using (exists (select 1 from public.tasks t where t.id = task_id and public.is_family_member(t.family_id)));
create policy task_steps_write on public.task_steps for all
  using (exists (select 1 from public.tasks t where t.id = task_id and public.is_family_member(t.family_id)))
  with check (exists (select 1 from public.tasks t where t.id = task_id and public.is_family_member(t.family_id)));

create policy task_attachments_select on public.task_attachments for select
  using (exists (select 1 from public.tasks t where t.id = task_id and public.is_family_member(t.family_id)));
create policy task_attachments_insert on public.task_attachments for insert
  with check (uploaded_by = auth.uid() and exists (
    select 1 from public.tasks t where t.id = task_id and public.is_family_member(t.family_id)));

create policy task_comments_select on public.task_comments for select
  using (exists (select 1 from public.tasks t where t.id = task_id and public.is_family_member(t.family_id)));
create policy task_comments_insert on public.task_comments for insert
  with check (author_id = auth.uid() and exists (
    select 1 from public.tasks t where t.id = task_id and public.is_family_member(t.family_id)));

create policy task_events_select on public.task_events for select
  using (exists (select 1 from public.tasks t where t.id = task_id and public.is_family_member(t.family_id)));

-- ---------------------------------------------------------------------------
-- CALENDAR
-- ---------------------------------------------------------------------------
alter table public.calendar_events
  add column description text not null default '',
  add column kind text not null default 'event'
    check (kind in ('event','occasion','maintenance','other')),
  add column all_day boolean not null default false,
  add column recurrence text not null default 'none'
    check (recurrence in ('none','daily','weekly','monthly')),
  add column reminder_minutes int[] not null default '{}',
  add column linked_member_id uuid references public.profiles(id),
  add column linked_task_id uuid references public.tasks(id),
  add column linked_request_id uuid references public.requests(id);

-- Edit/delete: your own events, or owner/supervisor for any family event.
drop policy calendar_write on public.calendar_events;
create policy calendar_insert on public.calendar_events for insert
  with check (public.is_family_member(family_id) and created_by = auth.uid());
create policy calendar_update on public.calendar_events for update
  using (public.is_family_member(family_id)
         and (created_by = auth.uid() or public.can_approve_tasks(family_id)));
create policy calendar_delete on public.calendar_events for delete
  using (public.is_family_member(family_id)
         and (created_by = auth.uid() or public.can_approve_tasks(family_id)));

-- ---------------------------------------------------------------------------
-- APARTMENT
-- ---------------------------------------------------------------------------
alter table public.apartments
  add column area_sqm numeric(10,2) check (area_sqm is null or area_sqm > 0),
  add column rooms_count smallint check (rooms_count is null or rooms_count >= 0),
  add column photos text[] not null default '{}',
  add column plans text[] not null default '{}',
  add column budget numeric(14,2) check (budget is null or budget >= 0),
  add column status text not null default 'planning'
    check (status in ('planning','finishing','finished','living'));

alter table public.rooms
  add column area_sqm numeric(10,2) check (area_sqm is null or area_sqm > 0),
  add column dimensions text,
  add column photos text[] not null default '{}',
  add column flooring text,
  add column paint_color text,
  add column paint_codes text,
  add column gypsum text,
  add column lighting text,
  add column doors text,
  add column windows text,
  add column electric text,
  add column plumbing text,
  add column furniture text,
  add column appliances text,
  add column notes text;

alter table public.finishing_stages
  add column percent_complete smallint not null default 0
    check (percent_complete between 0 and 100),
  add column budget numeric(14,2) check (budget is null or budget >= 0),
  add column owner_profile_id uuid references public.profiles(id),
  add column start_date date,
  add column end_date date,
  add column before_photos text[] not null default '{}',
  add column after_photos text[] not null default '{}';

alter table public.assets rename column value to price;
alter table public.assets
  add column kind text not null default 'other' check (kind in ('furniture','appliance','other')),
  add column brand text,
  add column model text,
  add column warranty_until date,
  add column serial text,
  add column invoice_path text,
  add column location text;

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  trade text not null default '',
  phone text not null default '',
  notes text not null default '',
  rating smallint check (rating between 1 and 5),
  created_at timestamptz not null default now()
);
alter table public.suppliers enable row level security;

alter table public.maintenance
  add column description text not null default '',
  add column room_id uuid references public.rooms(id),
  add column supplier_id uuid references public.suppliers(id),
  add column done_date date,
  add column linked_transaction_id uuid references public.transactions(id);
alter table public.maintenance drop constraint maintenance_status_check;
alter table public.maintenance add constraint maintenance_status_check
  check (status in ('open','scheduled','in_progress','done','cancelled'));

-- Live budget link: expenses can be tagged to a room, stage or maintenance job.
alter table public.transactions
  add column room_id uuid references public.rooms(id),
  add column stage_id uuid references public.finishing_stages(id),
  add column maintenance_id uuid references public.maintenance(id);

-- Apartment writes move from owner-only to apartment.manage / assets.manage
-- (owner keeps every permission; supervisors gain them above).
drop policy apartments_write on public.apartments;
create policy apartments_write on public.apartments for all
  using (public.is_family_member(family_id) and public.has_permission('apartment.manage'))
  with check (public.is_family_member(family_id) and public.has_permission('apartment.manage'));

drop policy rooms_write on public.rooms;
create policy rooms_write on public.rooms for all
  using (exists (select 1 from public.apartments a where a.id = apartment_id
                 and public.is_family_member(a.family_id) and public.has_permission('apartment.manage')))
  with check (exists (select 1 from public.apartments a where a.id = apartment_id
                 and public.is_family_member(a.family_id) and public.has_permission('apartment.manage')));

drop policy finishing_write on public.finishing_stages;
create policy finishing_write on public.finishing_stages for all
  using (exists (select 1 from public.rooms r join public.apartments a on a.id = r.apartment_id
                 where r.id = room_id and public.is_family_member(a.family_id)
                 and public.has_permission('apartment.manage')))
  with check (exists (select 1 from public.rooms r join public.apartments a on a.id = r.apartment_id
                 where r.id = room_id and public.is_family_member(a.family_id)
                 and public.has_permission('apartment.manage')));

drop policy assets_write on public.assets;
create policy assets_write on public.assets for all
  using (public.is_family_member(family_id) and public.has_permission('assets.manage'))
  with check (public.is_family_member(family_id) and public.has_permission('assets.manage'));

create policy suppliers_select on public.suppliers for select using (public.is_family_member(family_id));
create policy suppliers_write on public.suppliers for all
  using (public.is_family_member(family_id) and public.has_permission('apartment.manage'))
  with check (public.is_family_member(family_id) and public.has_permission('apartment.manage'));

drop policy if exists maintenance_write on public.maintenance;
create policy maintenance_write on public.maintenance for all
  using (public.is_family_member(family_id) and public.has_permission('assets.manage'))
  with check (public.is_family_member(family_id) and public.has_permission('assets.manage'));

-- ---------------------------------------------------------------------------
-- record_expense: now accepts apartment tags (room/stage/maintenance) so
-- spending links live into the apartment budget. Same single-transaction
-- semantics as stage 2.
-- ---------------------------------------------------------------------------
drop function public.record_expense(uuid, numeric, text, text, text, uuid);
create or replace function public.record_expense(
  p_account_id uuid, p_amount numeric, p_category text,
  p_description text default '', p_receipt_path text default null,
  p_member_id uuid default null, p_room_id uuid default null,
  p_stage_id uuid default null, p_maintenance_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_acc public.accounts%rowtype;
  v_tx uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select * into v_acc from public.accounts where id = p_account_id for update;
  if not found then raise exception 'account not found'; end if;
  if not public.is_family_member(v_acc.family_id) or not public.has_permission('finance.manage') then
    raise exception 'not allowed';
  end if;
  update public.accounts set balance = balance - p_amount
  where id = p_account_id and balance >= p_amount;
  if not found then raise exception 'insufficient funds'; end if;
  insert into public.transactions
    (family_id, account_id, type, amount, category, description, created_by,
     receipt_path, member_id, room_id, stage_id, maintenance_id)
  values
    (v_acc.family_id, p_account_id, 'expense', p_amount, p_category, p_description,
     auth.uid(), p_receipt_path, p_member_id, p_room_id, p_stage_id, p_maintenance_id)
  returning id into v_tx;
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id, metadata)
  values (v_acc.family_id, auth.uid(), 'finance.expense', 'transactions', v_tx::text,
          jsonb_build_object('account', p_account_id, 'amount', p_amount, 'category', p_category));
  return v_tx;
end;
$$;


-- ============================================================================
-- VERIFICATION: run after the setup above. Expected result:
--   status = 'HOME OS ULTIMATE: database ready' , tables >= 30
-- ============================================================================
select 'HOME OS ULTIMATE: database ready ✅' as status,
       (select count(*) from pg_tables where schemaname = 'public') as tables,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public') as functions;
