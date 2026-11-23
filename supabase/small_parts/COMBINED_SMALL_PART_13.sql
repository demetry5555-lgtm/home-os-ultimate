-- HOME OS PART 13 OF 34
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
alter table public.transactions add column receipt_path text;

      -- private storage path, never public URL
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
