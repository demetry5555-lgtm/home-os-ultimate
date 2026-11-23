-- HOME OS PART 25 OF 34
-- Requester cancels their own request (before it's decided).
create or replace function public.cancel_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests%rowtype;
begin
  select * into v_req from public.requests where id = p_request_id for update;
  if not found then raise exception 'request not found'; end if;
  if v_req.requester_id <> auth.uid() then raise exception 'not allowed'; end if;
  if v_req.status not in ('new','under_review','needs_info','deferred') then
    raise exception 'cannot cancel a decided request';
  end if;
  update public.requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now()
  where id = p_request_id;
  insert into public.request_events (request_id, actor_id, action, from_status, to_status)
  values (p_request_id, auth.uid(), 'cancel', v_req.status, 'cancelled');
end;
$$;

-- Link an approved money request to a real finance transaction.
create or replace function public.link_request_transaction(p_request_id uuid, p_transaction_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests%rowtype;
begin
  select * into v_req from public.requests where id = p_request_id;
  if not found then raise exception 'request not found'; end if;
  if not public.can_decide_requests(v_req.family_id) then raise exception 'not allowed'; end if;
  if v_req.status not in ('approved','partially_approved','completed') then
    raise exception 'only approved requests can be linked';
  end if;
  update public.requests set linked_transaction_id = p_transaction_id where id = p_request_id;
  insert into public.request_events (request_id, actor_id, action, reason)
  values (p_request_id, auth.uid(), 'link_transaction', p_transaction_id::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
drop policy if exists requests_select on public.requests;

drop policy if exists requests_insert on public.requests;

drop policy if exists requests_update_owner on public.requests;

create policy requests_select on public.requests for select
  using (requester_id = auth.uid() or public.can_decide_requests(family_id));

create policy requests_insert on public.requests for insert
  with check (public.is_family_member(family_id) and requester_id = auth.uid() and status = 'new');

-- No direct client updates: all state changes go through the functions above.

create policy request_events_select on public.request_events for select
  using (exists (select 1 from public.requests r
                 where r.id = request_id
                   and (r.requester_id = auth.uid() or public.can_decide_requests(r.family_id))));
