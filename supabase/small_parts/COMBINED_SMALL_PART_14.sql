-- HOME OS PART 14 OF 34
alter table public.budgets add column scope_id uuid;

  -- apartments.id or profiles.id

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
