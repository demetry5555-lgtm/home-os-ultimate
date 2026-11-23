-- HOME OS PART 03 OF 34
-- ---------------------------------------------------------------------------
-- Finance
-- ---------------------------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  type text not null check (type in ('cash','bank','wallet','card')),
  currency char(3) not null default 'EGP',
  balance numeric(14,2) not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  unique (family_id, name)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  account_id uuid not null references public.accounts(id),
  related_transaction_id uuid references public.transactions(id),
  type text not null check (type in ('income','expense','transfer')),
  amount numeric(14,2) not null check (amount > 0),
  category text not null default 'general',
  description text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index transactions_family_idx on public.transactions (family_id, created_at desc);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  category text not null,
  monthly_limit numeric(14,2) not null check (monthly_limit > 0),
  month date not null default date_trunc('month', now())::date,
  unique (family_id, category, month)
);

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  counterparty text not null,
  direction text not null check (direction in ('lent','borrowed')),
  principal numeric(14,2) not null check (principal > 0),
  remaining numeric(14,2) not null check (remaining >= 0),
  due_date date,
  created_at timestamptz not null default now(),
  check (remaining <= principal)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  loan_id uuid references public.loans(id) on delete cascade,
  transaction_id uuid references public.transactions(id),
  amount numeric(14,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  note text not null default ''
);
