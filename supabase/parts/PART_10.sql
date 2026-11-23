-- HOME OS PART 10 OF 10 (part 9B is the repair for part 9)
-- Mirrors the hosted setup page exactly. Hardened: safe to re-run any part.

-- ===========================================================================
-- HOME OS ULTIMATE - Stage 6: settings + bills/installments
-- Family settings fields (city, currency, default language) and a bills /
-- loan-installments entity whose due dates show on the calendar.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Family profile settings. Owner (existing policy) or a supervisor with the
-- family.manage permission may update them.
-- ---------------------------------------------------------------------------
alter table public.families
  add column if not exists city text,
  add column if not exists currency text not null default 'EGP',
  add column if not exists default_language text not null default 'en';

alter table public.families drop constraint if exists families_default_language_check;
alter table public.families
  add constraint families_default_language_check check (default_language in ('ar','en'));

do $$ begin
  drop policy if exists families_update_manage on public.families;
  create policy families_update_manage on public.families for update
    using (public.is_family_member(id) and public.has_permission('family.manage'));
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- bills: recurring bills (electricity, internet, rent) and loan installments.
-- due_date is always the NEXT due date; paying advances it by recurrence.
-- ---------------------------------------------------------------------------
create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  kind text not null default 'bill' check (kind in ('bill','installment')),
  title text not null check (char_length(title) between 1 and 160),
  category text not null default 'utilities',
  amount numeric(14,2) not null check (amount > 0),
  recurrence text not null default 'monthly' check (recurrence in ('once','monthly','quarterly','annual')),
  due_date date not null,
  loan_id uuid references public.loans(id) on delete set null,
  account_id uuid references public.accounts(id),
  note text not null default '',
  active boolean not null default true,
  last_paid_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists bills_family_idx on public.bills (family_id, due_date);

alter table public.bills enable row level security;

do $$ begin
  drop policy if exists bills_select on public.bills;
  create policy bills_select on public.bills for select
    using (public.is_family_member(family_id));
exception when duplicate_object then null;
end $$;
do $$ begin
  drop policy if exists bills_insert on public.bills;
  create policy bills_insert on public.bills for insert
    with check (public.is_family_member(family_id) and public.has_permission('finance.manage'));
exception when duplicate_object then null;
end $$;
do $$ begin
  drop policy if exists bills_update on public.bills;
  create policy bills_update on public.bills for update
    using (public.is_family_member(family_id) and public.has_permission('finance.manage'));
exception when duplicate_object then null;
end $$;
do $$ begin
  drop policy if exists bills_delete on public.bills;
  create policy bills_delete on public.bills for delete
    using (public.is_family_member(family_id) and public.has_permission('finance.manage'));
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- pay_bill: records the expense through record_expense (same balance checks
-- and audit trail), then advances the due date. One-shot bills deactivate.
-- ---------------------------------------------------------------------------
create or replace function public.pay_bill(p_bill_id uuid, p_account_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_bill public.bills%rowtype;
  v_tx uuid;
begin
  select * into v_bill from public.bills where id = p_bill_id for update;
  if not found then raise exception 'bill not found'; end if;
  if not public.is_family_member(v_bill.family_id) or not public.has_permission('finance.manage') then
    raise exception 'not allowed';
  end if;
  if not v_bill.active then raise exception 'bill is not active'; end if;
  v_tx := public.record_expense(p_account_id, v_bill.amount, v_bill.category, 'Bill: ' || v_bill.title);
  update public.bills set
    last_paid_at = now(),
    active = case when v_bill.recurrence = 'once' then false else v_bill.active end,
    due_date = case v_bill.recurrence
      when 'monthly' then v_bill.due_date + interval '1 month'
      when 'quarterly' then v_bill.due_date + interval '3 months'
      when 'annual' then v_bill.due_date + interval '1 year'
      else v_bill.due_date end::date
  where id = p_bill_id;
  return v_tx;
end;
$$;

select 'HOME OS ULTIMATE: database ready ✅' as status,
       (select count(*) from pg_tables where schemaname = 'public') as tables,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public') as functions;
