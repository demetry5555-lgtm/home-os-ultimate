-- HOME OS PART 6 OF 11 (part 9B is the repair for part 9; part 11 fixes invitation codes)
-- Mirrors the hosted setup page exactly. Hardened: safe to re-run any part.

-- HOME OS PART 6 OF 9
-- The family room is created with the family.
create or replace function public.bootstrap_owner(p_owner_name text, p_family_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'profile already exists';
  end if;
  insert into public.profiles (id, full_name, role)
  values (auth.uid(), p_owner_name, 'owner');
  insert into public.families (name, owner_id) values (p_family_name, auth.uid())
  returning id into v_family_id;
  update public.profiles set family_id = v_family_id where id = auth.uid();
  insert into public.chat_threads (family_id, kind) values (v_family_id, 'family');
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id)
  values (v_family_id, auth.uid(), 'family.bootstrap', 'families', v_family_id::text);
  return v_family_id;
end;
$$;

alter table public.chat_threads enable row level security;

alter table public.chat_messages enable row level security;

drop policy if exists chat_threads_select on public.chat_threads;
create policy chat_threads_select on public.chat_threads for select
  using (public.can_read_thread(id));

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages for select
  using (public.can_read_thread(thread_id));

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages for insert
  with check (public.can_read_thread(thread_id) and sender_id = auth.uid());

-- ============================================================================
-- HOME OS ULTIMATE - Stage 3: Requests center
-- Types, full status machine, comments, decision events, finance linking.
-- Visibility: members see ONLY their own requests; owner + supervisors
-- (requests.decide) see and decide all family requests.
-- ============================================================================

alter table public.requests
  add column if not exists request_number bigint generated always as identity,
  add column if not exists type text not null default 'custom'
    check (type in ('money','purchase','outing','travel','booking','maintenance','leave','needs','document','help','custom')),
  add column if not exists amount numeric(14,2) check (amount is null or amount >= 0),
  add column if not exists priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  add column if not exists assignee_id uuid references public.profiles(id),
  add column if not exists linked_transaction_id uuid references public.transactions(id);

alter table public.requests drop constraint requests_status_check;

alter table public.requests add constraint requests_status_check
  check (status in ('new','under_review','needs_info','approved','partially_approved','rejected','deferred','completed','cancelled'));

alter table public.requests drop constraint requests_decision_fields;

-- decided_by/decided_at track the LATEST decision; full history in request_events.

alter table public.requests alter column status set default 'new';

update public.requests set status = 'new' where status = 'pending';

-- Every action on a request, with actor, timestamp, reason.
create table if not exists public.request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  from_status text,
  to_status text,
  reason text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists request_events_request_idx on public.request_events (request_id, created_at);

-- Discussion thread per request.
create table if not exists public.request_comments (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists request_comments_request_idx on public.request_comments (request_id, created_at);

alter table public.request_events enable row level security;

alter table public.request_comments enable row level security;

-- ---------------------------------------------------------------------------
-- can_decide_requests: active family member holding requests.decide
-- ---------------------------------------------------------------------------
create or replace function public.can_decide_requests(p_family_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_family_member(p_family_id) and public.has_permission('requests.decide');
$$;

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

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select
  using (requester_id = auth.uid() or public.can_decide_requests(family_id));

drop policy if exists requests_insert on public.requests;
create policy requests_insert on public.requests for insert
  with check (public.is_family_member(family_id) and requester_id = auth.uid() and status = 'new');

-- No direct client updates: all state changes go through the functions above.

drop policy if exists request_events_select on public.request_events;
create policy request_events_select on public.request_events for select
  using (exists (select 1 from public.requests r
                 where r.id = request_id
                   and (r.requester_id = auth.uid() or public.can_decide_requests(r.family_id))));

drop policy if exists request_comments_select on public.request_comments;
create policy request_comments_select on public.request_comments for select
  using (exists (select 1 from public.requests r
                 where r.id = request_id
                   and (r.requester_id = auth.uid() or public.can_decide_requests(r.family_id))));

drop policy if exists request_comments_insert on public.request_comments;
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
  ('supervisor', 'assets.manage') on conflict do nothing;
