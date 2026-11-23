-- HOME OS PART 4 OF 7
-- Run only after part 3 has completed successfully.
create policy transactions_insert on public.transactions for insert
  with check (public.is_family_member(family_id) and public.has_permission('finance.manage'));

create policy budgets_all on public.budgets for all
  using (public.is_family_member(family_id) and public.has_permission('finance.manage'))
  with check (public.is_family_member(family_id) and public.has_permission('finance.manage'));

create policy loans_select on public.loans for select using (public.is_family_member(family_id));
create policy loans_write on public.loans for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

create policy payments_select on public.payments for select using (public.is_family_member(family_id));
create policy payments_insert on public.payments for insert
  with check (public.is_family_member(family_id) and public.has_permission('finance.manage'));

create policy salaries_select on public.salaries for select
  using (public.is_family_owner(family_id) or profile_id = auth.uid());
create policy salaries_write on public.salaries for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

-- Requests: members create their own and read the family's; owners decide via update.
create policy requests_select on public.requests for select using (public.is_family_member(family_id));
create policy requests_insert on public.requests for insert
  with check (public.is_family_member(family_id) and requester_id = auth.uid());
create policy requests_update_owner on public.requests for update
  using (public.is_family_owner(family_id));

-- Tasks
create policy tasks_select on public.tasks for select using (public.is_family_member(family_id));
create policy tasks_insert on public.tasks for insert
  with check (public.is_family_member(family_id) and created_by = auth.uid());
create policy tasks_update on public.tasks for update using (public.is_family_member(family_id));

-- Calendar
create policy calendar_select on public.calendar_events for select using (public.is_family_member(family_id));
create policy calendar_write on public.calendar_events for all
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));

-- Apartment: members read, owner manages.
create policy apartments_select on public.apartments for select using (public.is_family_member(family_id));
create policy apartments_write on public.apartments for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

create policy rooms_select on public.rooms for select
  using (exists (select 1 from public.apartments a where a.id = apartment_id and public.is_family_member(a.family_id)));
create policy rooms_write on public.rooms for all
  using (exists (select 1 from public.apartments a where a.id = apartment_id and public.is_family_owner(a.family_id)));

create policy finishing_select on public.finishing_stages for select
  using (exists (select 1 from public.rooms r join public.apartments a on a.id = r.apartment_id
                 where r.id = room_id and public.is_family_member(a.family_id)));
create policy finishing_write on public.finishing_stages for all
  using (exists (select 1 from public.rooms r join public.apartments a on a.id = r.apartment_id
                 where r.id = room_id and public.is_family_owner(a.family_id)));

create policy assets_select on public.assets for select using (public.is_family_member(family_id));
create policy assets_write on public.assets for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

create policy maintenance_select on public.maintenance for select using (public.is_family_member(family_id));
create policy maintenance_write on public.maintenance for all
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));

-- Documents: metadata is family-visible; the storage bucket stays private and
-- files are served only via short-lived signed URLs.
create policy documents_select on public.documents for select using (public.is_family_member(family_id));
create policy documents_insert on public.documents for insert
  with check (public.is_family_member(family_id) and owner_id = auth.uid());
create policy documents_delete on public.documents for delete
  using (owner_id = auth.uid() or public.is_family_owner(family_id));

-- Notifications: strictly per-recipient.
create policy notifications_select on public.notifications for select using (profile_id = auth.uid());
create policy notifications_update on public.notifications for update using (profile_id = auth.uid());


-- ============================================================================
-- HOME OS ULTIMATE - Stage 2: Finance OS
-- Atomic money, salaries with bonus/deduction, loan repayment, budget scopes,
-- receipts. All amounts numeric(14,2); every mutation is one transaction
-- inside a security-definer function. No client-side balance writes.
-- ============================================================================

-- Account types widen: home vaults and per-member accounts join cash/bank/wallet/card.
alter table public.accounts drop constraint accounts_type_check;
alter table public.accounts add constraint accounts_type_check
  check (type in ('cash','bank','wallet','vault','card','member'));
-- A member account belongs to one family member; NULL = family-wide account.
alter table public.accounts add column owner_profile_id uuid references public.profiles(id);

-- Receipts and member attribution on transactions.
alter table public.transactions add column receipt_path text;      -- private storage path, never public URL
alter table public.transactions add column member_id uuid references public.profiles(id);

-- A loan/advance can be tied to a family member.
alter table public.loans add column profile_id uuid references public.profiles(id);

-- Salaries: monthly or day-wage.
alter table public.salaries add column pay_type text not null default 'monthly'
  check (pay_type in ('monthly','daily'));

-- Payslips: one row per payout with the exact math frozen at payment time.
create table public.salary_payments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  salary_id uuid not null references public.salaries(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  period date not null,                            -- month (or day) the pay covers
  base numeric(14,2) not null check (base >= 0),
  bonus numeric(14,2) not null default 0 check (bonus >= 0),
  deduction numeric(14,2) not null default 0 check (deduction >= 0),
  net numeric(14,2) not null check (net >= 0),
  transaction_id uuid not null references public.transactions(id),
  paid_at timestamptz not null default now(),
  unique (salary_id, period)                       -- no double-paying a period
);
alter table public.salary_payments enable row level security;
create policy salary_payments_select on public.salary_payments for select
  using (public.is_family_owner(family_id) or profile_id = auth.uid());

-- Budgets: monthly or annual; family-wide, per apartment, or per member.
alter table public.budgets add column period text not null default 'monthly'
  check (period in ('monthly','annual'));
alter table public.budgets add column scope text not null default 'family'
  check (scope in ('family','apartment','member'));
alter table public.budgets add column scope_id uuid;  -- apartments.id or profiles.id

-- ---------------------------------------------------------------------------
-- record_income: credit an account atomically.
-- ---------------------------------------------------------------------------
create or replace function public.record_income(
  p_account_id uuid, p_amount numeric, p_category text, p_description text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_acc public.accounts%rowtype;
  v_tx uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select * into v_acc from public.accounts where id = p_account_id for update;
  if not found then raise exception 'account not found'; end if;
  if not public.is_family_member(v_acc.family_id) or not public.has_permission('finance.manage') then
    raise exception 'not allowed';
  end if;
  update public.accounts set balance = balance + p_amount where id = p_account_id;
  insert into public.transactions
    (family_id, account_id, type, amount, category, description, created_by)
  values
    (v_acc.family_id, p_account_id, 'income', p_amount, p_category, p_description, auth.uid())
  returning id into v_tx;
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id, metadata)
  values (v_acc.family_id, auth.uid(), 'finance.income', 'transactions', v_tx::text,
          jsonb_build_object('account', p_account_id, 'amount', p_amount));
  return v_tx;
end;
$$;
