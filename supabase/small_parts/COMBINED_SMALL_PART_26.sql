-- HOME OS PART 26 OF 34
create policy request_comments_select on public.request_comments for select
  using (exists (select 1 from public.requests r
                 where r.id = request_id
                   and (r.requester_id = auth.uid() or public.can_decide_requests(r.family_id))));

create policy request_comments_insert on public.request_comments for insert
  with check (author_id = auth.uid() and exists (
    select 1 from public.requests r
    where r.id = request_id
      and (r.requester_id = auth.uid() or public.can_decide_requests(r.family_id))));

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
