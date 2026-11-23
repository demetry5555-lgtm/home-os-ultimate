-- HOME OS PART 01 OF 34
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
