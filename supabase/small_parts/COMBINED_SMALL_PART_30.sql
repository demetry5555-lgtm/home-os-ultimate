-- HOME OS PART 30 OF 34
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
