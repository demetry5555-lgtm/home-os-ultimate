-- HOME OS PART 05 OF 34
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
