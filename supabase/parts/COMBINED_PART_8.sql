-- HOME OS PART 8 OF 10
-- Stage 4 (tasks, calendar, apartment). Run only after part 7 completed.
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
