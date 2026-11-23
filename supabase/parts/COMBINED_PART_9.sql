-- HOME OS PART 9 OF 10
-- Stage 4 (tasks, calendar, apartment). Run only after part 8 completed.

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
