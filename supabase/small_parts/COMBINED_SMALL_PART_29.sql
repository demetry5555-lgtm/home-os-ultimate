-- HOME OS PART 29 OF 34
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
