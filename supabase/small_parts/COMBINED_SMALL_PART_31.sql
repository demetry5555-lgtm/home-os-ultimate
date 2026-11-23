-- HOME OS PART 31 OF 34
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
