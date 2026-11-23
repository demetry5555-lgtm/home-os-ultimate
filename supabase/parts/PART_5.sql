-- HOME OS PART 5 OF 11 (part 9B is the repair for part 9; part 11 fixes invitation codes)
-- Mirrors the hosted setup page exactly. Hardened: safe to re-run any part.

-- HOME OS PART 5 OF 9
-- ---------------------------------------------------------------------------
-- budget_report: planned vs actual per budget row for a given month.
-- Actual = sum of expenses in the budget's category for that month,
-- filtered by scope (family / apartment via member link / single member).
-- ---------------------------------------------------------------------------
create or replace function public.budget_report(p_month date)
returns table (
  budget_id uuid, category text, scope text, scope_id uuid,
  planned numeric, actual numeric, remaining numeric
) language plpgsql security definer stable set search_path = public as $$
declare
  v_family_id uuid;
  v_from timestamptz;
  v_to timestamptz;
begin
  select family_id into v_family_id from public.profiles where id = auth.uid();
  if v_family_id is null then return; end if;
  v_from := p_month::timestamptz;
  v_to := (p_month + interval '1 month')::timestamptz;
  return query
  select b.id, b.category, b.scope, b.scope_id, b.monthly_limit,
    coalesce(sum(t.amount) filter (
      where (b.scope = 'family')
         or (b.scope = 'member' and t.member_id = b.scope_id)
         or (b.scope = 'apartment' and t.category like 'apartment:%')
    ), 0) as actual,
    b.monthly_limit - coalesce(sum(t.amount) filter (
      where (b.scope = 'family')
         or (b.scope = 'member' and t.member_id = b.scope_id)
         or (b.scope = 'apartment' and t.category like 'apartment:%')
    ), 0) as remaining
  from public.budgets b
  left join public.transactions t
    on t.family_id = b.family_id and t.type = 'expense'
   and t.category = b.category
   and t.created_at >= case when b.period = 'annual'
                            then date_trunc('year', p_month)::timestamptz else v_from end
   and t.created_at <  case when b.period = 'annual'
                            then (date_trunc('year', p_month) + interval '1 year')::timestamptz else v_to end
  where b.family_id = v_family_id and b.month = p_month
  group by b.id
  order by b.category;
end;
$$;

-- ---------------------------------------------------------------------------
-- finance_summary: the dashboard cards in one round trip.
-- ---------------------------------------------------------------------------
create or replace function public.finance_summary(p_month date default date_trunc('month', now())::date)
returns table (
  total_balance numeric, month_income numeric, month_expense numeric,
  open_loans_remaining numeric, budget_planned numeric, budget_actual numeric
) language plpgsql security definer stable set search_path = public as $$
declare
  v_family_id uuid;
  v_from timestamptz := p_month::timestamptz;
  v_to timestamptz := (p_month + interval '1 month')::timestamptz;
begin
  select family_id into v_family_id from public.profiles where id = auth.uid();
  if v_family_id is null then return; end if;
  return query
  select
    coalesce((select sum(a.balance) from public.accounts a where a.family_id = v_family_id), 0),
    coalesce((select sum(t.amount) from public.transactions t
              where t.family_id = v_family_id and t.type = 'income'
                and t.created_at >= v_from and t.created_at < v_to), 0),
    coalesce((select sum(t.amount) from public.transactions t
              where t.family_id = v_family_id and t.type = 'expense'
                and t.created_at >= v_from and t.created_at < v_to), 0),
    coalesce((select sum(l.remaining) from public.loans l
              where l.family_id = v_family_id and l.remaining > 0), 0),
    coalesce((select sum(b.monthly_limit) from public.budgets b
              where b.family_id = v_family_id and b.month = p_month), 0),
    coalesce((select sum(t.amount) from public.transactions t
              where t.family_id = v_family_id and t.type = 'expense'
                and t.created_at >= v_from and t.created_at < v_to
                and t.category in (select b.category from public.budgets b
                                   where b.family_id = v_family_id and b.month = p_month)), 0);
end;
$$;

-- ============================================================================
-- HOME OS ULTIMATE - Stage 2b: supervisor role, owner-only personal files,
-- family chat room schema.
-- ============================================================================

-- Roles: owner / supervisor / member
alter table public.profiles drop constraint profiles_role_check;

alter table public.profiles add constraint profiles_role_check
  check (role in ('owner','supervisor','member'));

alter table public.role_permissions drop constraint role_permissions_role_check;

alter table public.role_permissions add constraint role_permissions_role_check
  check (role in ('owner','supervisor','member'));

-- Supervisor grants: approve/reject requests, add expenses (finance.manage),
-- tasks; NOT family/invitation/member administration and NOT salaries.
insert into public.role_permissions (role, permission_key) values
  ('supervisor', 'finance.view'),
  ('supervisor', 'finance.manage'),
  ('supervisor', 'requests.create'),
  ('supervisor', 'requests.decide'),
  ('supervisor', 'tasks.manage') on conflict do nothing;

-- Owner appoints / demotes supervisors. Owner role itself is immutable.
create or replace function public.set_member_role(p_profile_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target public.profiles%rowtype;
begin
  select * into v_target from public.profiles where id = p_profile_id;
  if not found or not public.is_family_owner(v_target.family_id) then
    raise exception 'not allowed';
  end if;
  if v_target.role = 'owner' then
    raise exception 'cannot change the owner role';
  end if;
  if p_role not in ('member','supervisor') then
    raise exception 'invalid role';
  end if;
  update public.profiles set role = p_role where id = p_profile_id;
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id, metadata)
  values (v_target.family_id, auth.uid(), 'member.role', 'profiles',
          p_profile_id::text, jsonb_build_object('role', p_role));
end;
$$;

-- ---------------------------------------------------------------------------
-- Personal files: each member's private files/data, visible to the OWNER only.
-- visibility = 'owner_only' (default, the sensitive store) or 'family'.
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists visibility text not null default 'owner_only'
    check (visibility in ('owner_only','family')),
  add column if not exists subject_profile_id uuid references public.profiles(id);

drop policy documents_select on public.documents;

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select
  using (
    public.is_family_owner(family_id)
    or (visibility = 'family' and public.is_family_member(family_id))
  );

-- ---------------------------------------------------------------------------
-- Chat: one family room per family + private 1:1 threads between members.
-- ---------------------------------------------------------------------------
create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  kind text not null check (kind in ('family','direct')),
  -- direct threads: sorted pair "uidA:uidB" makes the pair unique per family
  direct_key text,
  created_at timestamptz not null default now(),
  check ((kind = 'family' and direct_key is null) or (kind = 'direct' and direct_key is not null))
);

create unique index if not exists chat_threads_family_room_uq on public.chat_threads (family_id) where kind = 'family';

create unique index if not exists chat_threads_direct_uq on public.chat_threads (family_id, direct_key) where kind = 'direct';

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, created_at);

-- Thread access: family room -> any active family member; direct -> the pair only.
create or replace function public.can_read_thread(p_thread_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.chat_threads ct
    where ct.id = p_thread_id and (
      (ct.kind = 'family' and public.is_family_member(ct.family_id))
      or (ct.kind = 'direct'
          and public.is_family_member(ct.family_id)
          and (':' || ct.direct_key || ':') like '%:' || auth.uid()::text || ':%')
    )
  );
$$;

-- Open (or get) the private thread between the caller and another member.
create or replace function public.open_direct_thread(p_other_profile_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_other public.profiles%rowtype;
  v_me public.profiles%rowtype;
  v_key text;
  v_thread uuid;
begin
  select * into v_me from public.profiles where id = auth.uid() and status = 'active';
  select * into v_other from public.profiles where id = p_other_profile_id and status = 'active';
  if v_me.id is null or v_other.id is null or v_me.family_id is distinct from v_other.family_id then
    raise exception 'not allowed';
  end if;
  if v_me.id = v_other.id then
    raise exception 'cannot open a thread with yourself';
  end if;
  v_key := least(v_me.id::text, v_other.id::text) || ':' || greatest(v_me.id::text, v_other.id::text);
  insert into public.chat_threads (family_id, kind, direct_key)
  values (v_me.family_id, 'direct', v_key)
  on conflict (family_id, direct_key) where kind = 'direct' do nothing;
  select id into v_thread from public.chat_threads
  where family_id = v_me.family_id and kind = 'direct' and direct_key = v_key;
  return v_thread;
end;
$$;
