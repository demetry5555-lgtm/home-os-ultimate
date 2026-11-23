-- HOME OS PART 32 OF 34
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
