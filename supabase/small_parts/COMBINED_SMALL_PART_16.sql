-- HOME OS PART 16 OF 34
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
