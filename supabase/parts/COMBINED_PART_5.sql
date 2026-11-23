-- HOME OS PART 5 OF 7
-- Run only after part 4 has completed successfully.

-- ---------------------------------------------------------------------------
-- record_expense: debit an account atomically; fails on insufficient funds.
-- ---------------------------------------------------------------------------
create or replace function public.record_expense(
  p_account_id uuid, p_amount numeric, p_category text,
  p_description text default '', p_receipt_path text default null,
  p_member_id uuid default null
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
  update public.accounts set balance = balance - p_amount
  where id = p_account_id and balance >= p_amount;
  if not found then raise exception 'insufficient funds'; end if;
  insert into public.transactions
    (family_id, account_id, type, amount, category, description, created_by, receipt_path, member_id)
  values
    (v_acc.family_id, p_account_id, 'expense', p_amount, p_category, p_description,
     auth.uid(), p_receipt_path, p_member_id)
  returning id into v_tx;
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id, metadata)
  values (v_acc.family_id, auth.uid(), 'finance.expense', 'transactions', v_tx::text,
          jsonb_build_object('account', p_account_id, 'amount', p_amount, 'category', p_category));
  return v_tx;
end;
$$;

-- ---------------------------------------------------------------------------
-- repay_loan: partial or full. Locks the loan row, caps at remaining,
-- writes payment + expense transaction + decrements remaining, all or nothing.
-- ---------------------------------------------------------------------------
create or replace function public.repay_loan(
  p_loan_id uuid, p_account_id uuid, p_amount numeric
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_loan public.loans%rowtype;
  v_tx uuid;
  v_payment uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found then raise exception 'loan not found'; end if;
  if not public.is_family_member(v_loan.family_id) or not public.has_permission('finance.manage') then
    raise exception 'not allowed';
  end if;
  if p_amount > v_loan.remaining then raise exception 'amount exceeds remaining balance'; end if;
  if v_loan.direction = 'borrowed' then
    -- we pay money out of the account
    v_tx := public.record_expense(p_account_id, p_amount, 'loan_repayment',
                                  'loan ' || p_loan_id::text, null, v_loan.profile_id);
  else
    -- lent money comes back into the account
    v_tx := public.record_income(p_account_id, p_amount, 'loan_repayment',
                                 'loan ' || p_loan_id::text);
  end if;
  update public.loans set remaining = remaining - p_amount where id = p_loan_id;
  insert into public.payments (family_id, loan_id, transaction_id, amount)
  values (v_loan.family_id, p_loan_id, v_tx, p_amount)
  returning id into v_payment;
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id, metadata)
  values (v_loan.family_id, auth.uid(), 'finance.loan_repay', 'loans', p_loan_id::text,
          jsonb_build_object('amount', p_amount, 'remaining', v_loan.remaining - p_amount));
  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------
-- pay_salary: net = base + bonus - deduction, paid from an account atomically.
-- One payslip per salary per period (unique constraint blocks double pay).
-- ---------------------------------------------------------------------------
create or replace function public.pay_salary(
  p_salary_id uuid, p_account_id uuid,
  p_bonus numeric default 0, p_deduction numeric default 0,
  p_period date default date_trunc('month', now())::date
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sal public.salaries%rowtype;
  v_net numeric(14,2);
  v_tx uuid;
  v_pay uuid;
begin
  if coalesce(p_bonus,0) < 0 or coalesce(p_deduction,0) < 0 then
    raise exception 'bonus and deduction must be non-negative';
  end if;
  select * into v_sal from public.salaries where id = p_salary_id and active;
  if not found then raise exception 'salary not found or inactive'; end if;
  if not public.is_family_owner(v_sal.family_id) then raise exception 'not allowed'; end if;
  v_net := v_sal.amount + coalesce(p_bonus,0) - coalesce(p_deduction,0);
  if v_net <= 0 then raise exception 'net pay must be positive'; end if;
  v_tx := public.record_expense(p_account_id, v_net, 'salary',
                                'salary ' || p_period::text, null, v_sal.profile_id);
  insert into public.salary_payments
    (family_id, salary_id, profile_id, period, base, bonus, deduction, net, transaction_id)
  values
    (v_sal.family_id, p_salary_id, v_sal.profile_id, p_period,
     v_sal.amount, coalesce(p_bonus,0), coalesce(p_deduction,0), v_net, v_tx)
  returning id into v_pay;
  insert into public.notifications (profile_id, family_id, kind, title, body)
  values (v_sal.profile_id, v_sal.family_id, 'salary',
          'Salary paid', 'Net ' || v_net::text || ' for ' || p_period::text);
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id, metadata)
  values (v_sal.family_id, auth.uid(), 'finance.salary_pay', 'salary_payments', v_pay::text,
          jsonb_build_object('net', v_net, 'period', p_period));
  return v_pay;
end;
$$;

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
