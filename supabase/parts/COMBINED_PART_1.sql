-- HOME OS PART 1 OF 7
-- Run the parts strictly in order, each one once, in the Supabase SQL Editor.
-- ============================================================================
-- HOME OS ULTIMATE - COMPLETE DATABASE SETUP (stages 1-3 combined)
-- Split for mobile pasting. Each part runs once, in order, in the SQL Editor.
-- Merges migrations 0001_init + 0002_finance + 0003_supervisor_files_chat
-- + 0004_requests, in order. Re-running on the same project will error at
-- the first CREATE TABLE - that is expected; it means it already ran.
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
