-- HOME OS PART 10 OF 10
-- Stage 4 (tasks, calendar, apartment). Run only after part 9 completed.

drop policy if exists maintenance_write on public.maintenance;
create policy maintenance_write on public.maintenance for all
  using (public.is_family_member(family_id) and public.has_permission('assets.manage'))
  with check (public.is_family_member(family_id) and public.has_permission('assets.manage'));

-- ---------------------------------------------------------------------------
-- record_expense: now accepts apartment tags (room/stage/maintenance) so
-- spending links live into the apartment budget. Same single-transaction
-- semantics as stage 2.
-- ---------------------------------------------------------------------------
drop function public.record_expense(uuid, numeric, text, text, text, uuid);
create or replace function public.record_expense(
  p_account_id uuid, p_amount numeric, p_category text,
  p_description text default '', p_receipt_path text default null,
  p_member_id uuid default null, p_room_id uuid default null,
  p_stage_id uuid default null, p_maintenance_id uuid default null
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
    (family_id, account_id, type, amount, category, description, created_by,
     receipt_path, member_id, room_id, stage_id, maintenance_id)
  values
    (v_acc.family_id, p_account_id, 'expense', p_amount, p_category, p_description,
     auth.uid(), p_receipt_path, p_member_id, p_room_id, p_stage_id, p_maintenance_id)
  returning id into v_tx;
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id, metadata)
  values (v_acc.family_id, auth.uid(), 'finance.expense', 'transactions', v_tx::text,
          jsonb_build_object('account', p_account_id, 'amount', p_amount, 'category', p_category));
  return v_tx;
end;
$$;


-- ============================================================================
-- VERIFICATION: run after the setup above. Expected result:
--   status = 'HOME OS ULTIMATE: database ready' , tables >= 30
-- ============================================================================
select 'HOME OS ULTIMATE: database ready ✅' as status,
       (select count(*) from pg_tables where schemaname = 'public') as tables,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public') as functions;
