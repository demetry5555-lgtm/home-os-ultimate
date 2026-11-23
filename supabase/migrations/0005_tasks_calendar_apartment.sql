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
  add check (due_date is null or start_date is null or due_date >= start_date);

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
-- spawn_task_recurrence: inserts the next occurrence of a recurring task,
-- copying its steps. Called by set_task_status after a completion.
-- ---------------------------------------------------------------------------
create or replace function public.spawn_task_recurrence(p_task_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_task public.tasks%rowtype;
  v_new_id uuid;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found or v_task.recurrence = 'none' then return; end if;
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
end;
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
    perform public.spawn_task_recurrence(p_task_id);
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
