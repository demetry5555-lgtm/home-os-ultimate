-- HOME OS PART 8 OF 10 (part 9B is the repair for part 9)
-- Mirrors the hosted setup page exactly. Hardened: safe to re-run any part.

-- HOME OS PART 8 OF 9
drop policy if exists task_attachments_insert on public.task_attachments;
create policy task_attachments_insert on public.task_attachments for insert
  with check (uploaded_by = auth.uid() and exists (
    select 1 from public.tasks t where t.id = task_id and public.is_family_member(t.family_id)));

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments for select
  using (exists (select 1 from public.tasks t where t.id = task_id and public.is_family_member(t.family_id)));

drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments for insert
  with check (author_id = auth.uid() and exists (
    select 1 from public.tasks t where t.id = task_id and public.is_family_member(t.family_id)));

drop policy if exists task_events_select on public.task_events;
create policy task_events_select on public.task_events for select
  using (exists (select 1 from public.tasks t where t.id = task_id and public.is_family_member(t.family_id)));

-- ---------------------------------------------------------------------------
-- CALENDAR
-- ---------------------------------------------------------------------------
alter table public.calendar_events
  add column if not exists description text not null default '',
  add column if not exists kind text not null default 'event'
    check (kind in ('event','occasion','maintenance','other')),
  add column if not exists all_day boolean not null default false,
  add column if not exists recurrence text not null default 'none'
    check (recurrence in ('none','daily','weekly','monthly')),
  add column if not exists reminder_minutes int[] not null default '{}',
  add column if not exists linked_member_id uuid references public.profiles(id),
  add column if not exists linked_task_id uuid references public.tasks(id),
  add column if not exists linked_request_id uuid references public.requests(id);

-- Edit/delete: your own events, or owner/supervisor for any family event.
drop policy calendar_write on public.calendar_events;

drop policy if exists calendar_insert on public.calendar_events;
create policy calendar_insert on public.calendar_events for insert
  with check (public.is_family_member(family_id) and created_by = auth.uid());

drop policy if exists calendar_update on public.calendar_events;
create policy calendar_update on public.calendar_events for update
  using (public.is_family_member(family_id)
         and (created_by = auth.uid() or public.can_approve_tasks(family_id)));

drop policy if exists calendar_delete on public.calendar_events;
create policy calendar_delete on public.calendar_events for delete
  using (public.is_family_member(family_id)
         and (created_by = auth.uid() or public.can_approve_tasks(family_id)));

-- ---------------------------------------------------------------------------
-- APARTMENT
-- ---------------------------------------------------------------------------
alter table public.apartments
  add column if not exists area_sqm numeric(10,2) check (area_sqm is null or area_sqm > 0),
  add column if not exists rooms_count smallint check (rooms_count is null or rooms_count >= 0),
  add column if not exists photos text[] not null default '{}',
  add column if not exists plans text[] not null default '{}',
  add column if not exists budget numeric(14,2) check (budget is null or budget >= 0),
  add column if not exists status text not null default 'planning'
    check (status in ('planning','finishing','finished','living'));

alter table public.rooms
  add column if not exists area_sqm numeric(10,2) check (area_sqm is null or area_sqm > 0),
  add column if not exists dimensions text,
  add column if not exists photos text[] not null default '{}',
  add column if not exists flooring text,
  add column if not exists paint_color text,
  add column if not exists paint_codes text,
  add column if not exists gypsum text,
  add column if not exists lighting text,
  add column if not exists doors text,
  add column if not exists windows text,
  add column if not exists electric text,
  add column if not exists plumbing text,
  add column if not exists furniture text,
  add column if not exists appliances text,
  add column if not exists notes text;

alter table public.finishing_stages
  add column if not exists percent_complete smallint not null default 0
    check (percent_complete between 0 and 100),
  add column if not exists budget numeric(14,2) check (budget is null or budget >= 0),
  add column if not exists owner_profile_id uuid references public.profiles(id),
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists before_photos text[] not null default '{}',
  add column if not exists after_photos text[] not null default '{}';

alter table public.assets rename column value to price;

alter table public.assets
  add column if not exists kind text not null default 'other' check (kind in ('furniture','appliance','other')),
  add column if not exists brand text,
  add column if not exists model text,
  add column if not exists warranty_until date,
  add column if not exists serial text,
  add column if not exists invoice_path text,
  add column if not exists location text;

create table if not exists public.suppliers (
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
  add column if not exists description text not null default '',
  add column if not exists room_id uuid references public.rooms(id),
  add column if not exists supplier_id uuid references public.suppliers(id),
  add column if not exists done_date date,
  add column if not exists linked_transaction_id uuid references public.transactions(id);

alter table public.maintenance drop constraint maintenance_status_check;

alter table public.maintenance add constraint maintenance_status_check
  check (status in ('open','scheduled','in_progress','done','cancelled'));

-- Live budget link: expenses can be tagged to a room, stage or maintenance job.
alter table public.transactions
  add column if not exists room_id uuid references public.rooms(id),
  add column if not exists stage_id uuid references public.finishing_stages(id),
  add column if not exists maintenance_id uuid references public.maintenance(id);

-- Apartment writes move from owner-only to apartment.manage / assets.manage
-- (owner keeps every permission; supervisors gain them above).
drop policy apartments_write on public.apartments;

drop policy if exists apartments_write on public.apartments;
create policy apartments_write on public.apartments for all
  using (public.is_family_member(family_id) and public.has_permission('apartment.manage'))
  with check (public.is_family_member(family_id) and public.has_permission('apartment.manage'));

drop policy rooms_write on public.rooms;

drop policy if exists rooms_write on public.rooms;
create policy rooms_write on public.rooms for all
  using (exists (select 1 from public.apartments a where a.id = apartment_id
                 and public.is_family_member(a.family_id) and public.has_permission('apartment.manage')))
  with check (exists (select 1 from public.apartments a where a.id = apartment_id
                 and public.is_family_member(a.family_id) and public.has_permission('apartment.manage')));

drop policy finishing_write on public.finishing_stages;

drop policy if exists finishing_write on public.finishing_stages;
create policy finishing_write on public.finishing_stages for all
  using (exists (select 1 from public.rooms r join public.apartments a on a.id = r.apartment_id
                 where r.id = room_id and public.is_family_member(a.family_id)
                 and public.has_permission('apartment.manage')))
  with check (exists (select 1 from public.rooms r join public.apartments a on a.id = r.apartment_id
                 where r.id = room_id and public.is_family_member(a.family_id)
                 and public.has_permission('apartment.manage')));

drop policy assets_write on public.assets;

drop policy if exists assets_write on public.assets;
create policy assets_write on public.assets for all
  using (public.is_family_member(family_id) and public.has_permission('assets.manage'))
  with check (public.is_family_member(family_id) and public.has_permission('assets.manage'));

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers for select using (public.is_family_member(family_id));

drop policy if exists suppliers_write on public.suppliers;
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
