-- HOME OS PART 28 OF 34
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
