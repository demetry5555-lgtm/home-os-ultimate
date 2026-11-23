-- HOME OS PART 09 OF 34
-- Atomic money transfer between two family accounts.
-- Locks both rows in a fixed order; all-or-nothing.
create or replace function public.transfer_funds(
  p_from_account uuid, p_to_account uuid, p_amount numeric, p_description text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_from public.accounts%rowtype;
  v_to public.accounts%rowtype;
  v_low uuid; v_high uuid;
  v_tx_out uuid; v_tx_in uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  select * into v_from from public.accounts where id = p_from_account;
  select * into v_to   from public.accounts where id = p_to_account;
  if not found or v_from.family_id is distinct from v_to.family_id then
    raise exception 'accounts not in the same family';
  end if;
  if not public.has_permission('finance.manage')
     or not public.is_family_member(v_from.family_id) then
    raise exception 'not allowed';
  end if;
  -- lock in id order to avoid deadlocks
  v_low  := least(p_from_account, p_to_account);
  v_high := greatest(p_from_account, p_to_account);
  perform 1 from public.accounts where id = v_low  for update;
  perform 1 from public.accounts where id = v_high for update;
  update public.accounts set balance = balance - p_amount
  where id = p_from_account and balance >= p_amount
  returning id into v_tx_out;
  if v_tx_out is null then
    raise exception 'insufficient funds';
  end if;
  update public.accounts set balance = balance + p_amount where id = p_to_account;
  insert into public.transactions
    (family_id, account_id, type, amount, category, description, created_by)
  values
    (v_from.family_id, p_from_account, 'transfer', p_amount, 'transfer', p_description, auth.uid())
  returning id into v_tx_out;
  insert into public.transactions
    (family_id, account_id, type, amount, category, description, created_by, related_transaction_id)
  values
    (v_from.family_id, p_to_account, 'transfer', p_amount, 'transfer', p_description, auth.uid(), v_tx_out)
  returning id into v_tx_in;
  insert into public.audit_logs (family_id, actor_id, action, entity, metadata)
  values (v_from.family_id, auth.uid(), 'finance.transfer', 'accounts',
          jsonb_build_object('from', p_from_account, 'to', p_to_account, 'amount', p_amount));
  return v_tx_out;
end;
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.profiles          enable row level security;

alter table public.families          enable row level security;

alter table public.invitations       enable row level security;

alter table public.session_events    enable row level security;
