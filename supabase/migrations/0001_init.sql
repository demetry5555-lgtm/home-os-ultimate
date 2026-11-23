-- ============================================================================
-- HOME OS ULTIMATE - Stage 1 foundation schema
-- PostgreSQL / Supabase. All access enforced server-side via RLS.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enumerated lookup: permissions catalog + role -> permission grants
-- ---------------------------------------------------------------------------
create table if not exists public.permissions (
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
  ('members.suspend',      'Suspend or reactivate member accounts') on conflict (key) do nothing;

create table if not exists public.role_permissions (
  role text not null check (role in ('owner','member')),
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role, permission_key)
);

insert into public.role_permissions (role, permission_key)
  select 'owner', key from public.permissions
on conflict do nothing;

insert into public.role_permissions (role, permission_key) values
  ('member', 'finance.view'),
  ('member', 'requests.create'),
  ('member', 'tasks.manage') on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Core identity
-- ---------------------------------------------------------------------------
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
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
create table if not exists public.invitations (
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
create index if not exists invitations_family_status_idx on public.invitations (family_id, status);

-- ---------------------------------------------------------------------------
-- Sessions (audit trail of sign-in events; Supabase Auth owns the real tokens)
-- ---------------------------------------------------------------------------
create table if not exists public.session_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('sign_in','sign_out','sign_up')),
  user_agent text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  family_id uuid references public.families(id),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_family_idx on public.audit_logs (family_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Finance
-- ---------------------------------------------------------------------------
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  type text not null check (type in ('cash','bank','wallet','card')),
  currency char(3) not null default 'EGP',
  balance numeric(14,2) not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  unique (family_id, name)
);

create table if not exists public.transactions (
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
create index if not exists transactions_family_idx on public.transactions (family_id, created_at desc);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  category text not null,
  monthly_limit numeric(14,2) not null check (monthly_limit > 0),
  month date not null default date_trunc('month', now())::date,
  unique (family_id, category, month)
);

create table if not exists public.loans (
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

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  loan_id uuid references public.loans(id) on delete cascade,
  transaction_id uuid references public.transactions(id),
  amount numeric(14,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  note text not null default ''
);

create table if not exists public.salaries (
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
create table if not exists public.requests (
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

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  assignee_id uuid references public.profiles(id),
  status text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  due_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.calendar_events (
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
create table if not exists public.apartments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  address text,
  created_at timestamptz not null default now(),
  unique (family_id)                          -- one apartment per family for now
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references public.apartments(id) on delete cascade,
  name text not null,
  floor smallint not null default 0,
  unique (apartment_id, name)
);

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
drop policy if exists permissions_read on public.permissions;
create policy permissions_read on public.permissions for select using (auth.uid() is not null);
drop policy if exists role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions for select using (auth.uid() is not null);

-- Profiles: family members see each other; you always see and edit yourself.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_family_member(family_id));
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

-- Families: members can read; only owner can update.
drop policy if exists families_select on public.families;
create policy families_select on public.families for select using (public.is_family_member(id));
drop policy if exists families_update_owner on public.families;
create policy families_update_owner on public.families for update using (public.is_family_owner(id));

-- Invitations: only the family owner reads the list; writes go through the
-- security-definer functions (create_invitation / accept / revoke).
drop policy if exists invitations_select_owner on public.invitations;
create policy invitations_select_owner on public.invitations for select
  using (public.is_family_owner(family_id));

-- Session events: you read and insert only your own.
drop policy if exists session_events_select on public.session_events;
create policy session_events_select on public.session_events for select using (user_id = auth.uid());
drop policy if exists session_events_insert on public.session_events;
create policy session_events_insert on public.session_events for insert with check (user_id = auth.uid());

-- Audit log: family members read; only functions insert (no client policy).
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select
  using (family_id is not null and public.is_family_member(family_id));

-- Finance
drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts for select using (public.is_family_member(family_id));
drop policy if exists accounts_write on public.accounts;
create policy accounts_write on public.accounts for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions for select using (public.is_family_member(family_id));
drop policy if exists transactions_insert on public.transactions;
create policy transactions_insert on public.transactions for insert
  with check (public.is_family_member(family_id) and public.has_permission('finance.manage'));

drop policy if exists budgets_all on public.budgets;
create policy budgets_all on public.budgets for all
  using (public.is_family_member(family_id) and public.has_permission('finance.manage'))
  with check (public.is_family_member(family_id) and public.has_permission('finance.manage'));

drop policy if exists loans_select on public.loans;
create policy loans_select on public.loans for select using (public.is_family_member(family_id));
drop policy if exists loans_write on public.loans;
create policy loans_write on public.loans for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select using (public.is_family_member(family_id));
drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments for insert
  with check (public.is_family_member(family_id) and public.has_permission('finance.manage'));

drop policy if exists salaries_select on public.salaries;
create policy salaries_select on public.salaries for select
  using (public.is_family_owner(family_id) or profile_id = auth.uid());
drop policy if exists salaries_write on public.salaries;
create policy salaries_write on public.salaries for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

-- Requests: members create their own and read the family's; owners decide via update.
drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select using (public.is_family_member(family_id));
drop policy if exists requests_insert on public.requests;
create policy requests_insert on public.requests for insert
  with check (public.is_family_member(family_id) and requester_id = auth.uid());
drop policy if exists requests_update_owner on public.requests;
create policy requests_update_owner on public.requests for update
  using (public.is_family_owner(family_id));

-- Tasks
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select using (public.is_family_member(family_id));
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert
  with check (public.is_family_member(family_id) and created_by = auth.uid());
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update using (public.is_family_member(family_id));

-- Calendar
drop policy if exists calendar_select on public.calendar_events;
create policy calendar_select on public.calendar_events for select using (public.is_family_member(family_id));
drop policy if exists calendar_write on public.calendar_events;
create policy calendar_write on public.calendar_events for all
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));

-- Apartment: members read, owner manages.
drop policy if exists apartments_select on public.apartments;
create policy apartments_select on public.apartments for select using (public.is_family_member(family_id));
drop policy if exists apartments_write on public.apartments;
create policy apartments_write on public.apartments for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms for select
  using (exists (select 1 from public.apartments a where a.id = apartment_id and public.is_family_member(a.family_id)));
drop policy if exists rooms_write on public.rooms;
create policy rooms_write on public.rooms for all
  using (exists (select 1 from public.apartments a where a.id = apartment_id and public.is_family_owner(a.family_id)));

drop policy if exists finishing_select on public.finishing_stages;
create policy finishing_select on public.finishing_stages for select
  using (exists (select 1 from public.rooms r join public.apartments a on a.id = r.apartment_id
                 where r.id = room_id and public.is_family_member(a.family_id)));
drop policy if exists finishing_write on public.finishing_stages;
create policy finishing_write on public.finishing_stages for all
  using (exists (select 1 from public.rooms r join public.apartments a on a.id = r.apartment_id
                 where r.id = room_id and public.is_family_owner(a.family_id)));

drop policy if exists assets_select on public.assets;
create policy assets_select on public.assets for select using (public.is_family_member(family_id));
drop policy if exists assets_write on public.assets;
create policy assets_write on public.assets for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

drop policy if exists maintenance_select on public.maintenance;
create policy maintenance_select on public.maintenance for select using (public.is_family_member(family_id));
drop policy if exists maintenance_write on public.maintenance;
create policy maintenance_write on public.maintenance for all
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));

-- Documents: metadata is family-visible; the storage bucket stays private and
-- files are served only via short-lived signed URLs.
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select using (public.is_family_member(family_id));
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert
  with check (public.is_family_member(family_id) and owner_id = auth.uid());
drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete
  using (owner_id = auth.uid() or public.is_family_owner(family_id));

-- Notifications: strictly per-recipient.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select using (profile_id = auth.uid());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update using (profile_id = auth.uid());
