-- HOME OS PART 22 OF 34
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

create policy chat_threads_select on public.chat_threads for select
  using (public.can_read_thread(id));

create policy chat_messages_select on public.chat_messages for select
  using (public.can_read_thread(thread_id));

create policy chat_messages_insert on public.chat_messages for insert
  with check (public.can_read_thread(thread_id) and sender_id = auth.uid());

-- ============================================================================
-- HOME OS ULTIMATE - Stage 3: Requests center
-- Types, full status machine, comments, decision events, finance linking.
-- Visibility: members see ONLY their own requests; owner + supervisors
-- (requests.decide) see and decide all family requests.
-- ============================================================================

alter table public.requests
  add column request_number bigint generated always as identity,
  add column type text not null default 'custom'
    check (type in ('money','purchase','outing','travel','booking','maintenance','leave','needs','document','help','custom')),
  add column amount numeric(14,2) check (amount is null or amount >= 0),
  add column priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  add column assignee_id uuid references public.profiles(id),
  add column linked_transaction_id uuid references public.transactions(id);

alter table public.requests drop constraint requests_status_check;

alter table public.requests add constraint requests_status_check
  check (status in ('new','under_review','needs_info','approved','partially_approved','rejected','deferred','completed','cancelled'));

alter table public.requests drop constraint requests_decision_fields;
