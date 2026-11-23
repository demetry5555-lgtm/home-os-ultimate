-- HOME OS PART 24 OF 34
-- ---------------------------------------------------------------------------
-- decide_request: the ONLY way requests change state. Validates the
-- transition, records the event with reason, notifies the requester.
-- ---------------------------------------------------------------------------
create or replace function public.decide_request(
  p_request_id uuid, p_to_status text, p_reason text default ''
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests%rowtype;
  v_valid boolean;
begin
  select * into v_req from public.requests where id = p_request_id for update;
  if not found then raise exception 'request not found'; end if;
  if not public.can_decide_requests(v_req.family_id) then raise exception 'not allowed'; end if;

  v_valid := case v_req.status
    when 'new' then p_to_status in ('under_review','needs_info','approved','partially_approved','rejected','deferred')
    when 'under_review' then p_to_status in ('needs_info','approved','partially_approved','rejected','deferred')
    when 'needs_info' then p_to_status in ('under_review','approved','partially_approved','rejected','deferred')
    when 'approved' then p_to_status = 'completed'
    when 'partially_approved' then p_to_status = 'completed'
    when 'deferred' then p_to_status in ('under_review','rejected')
    else false
  end;
  if not v_valid then
    raise exception 'invalid transition from % to %', v_req.status, p_to_status;
  end if;

  update public.requests
  set status = p_to_status, decided_by = auth.uid(), decided_at = now()
  where id = p_request_id;

  insert into public.request_events (request_id, actor_id, action, from_status, to_status, reason)
  values (p_request_id, auth.uid(), 'decision', v_req.status, p_to_status, p_reason);

  insert into public.notifications (profile_id, family_id, kind, title, body)
  values (v_req.requester_id, v_req.family_id, 'request',
          'Request ' || p_to_status,
          coalesce(nullif(p_reason, ''), v_req.title));
end;
$$;
