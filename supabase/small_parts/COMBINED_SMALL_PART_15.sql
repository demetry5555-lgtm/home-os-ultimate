-- HOME OS PART 15 OF 34
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
