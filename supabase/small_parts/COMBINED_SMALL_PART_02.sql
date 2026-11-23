-- HOME OS PART 02 OF 34
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
