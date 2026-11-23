-- HOME OS PART 19 OF 34
-- ---------------------------------------------------------------------------
-- finance_summary: the dashboard cards in one round trip.
-- ---------------------------------------------------------------------------
create or replace function public.finance_summary(p_month date default date_trunc('month', now())::date)
returns table (
  total_balance numeric, month_income numeric, month_expense numeric,
  open_loans_remaining numeric, budget_planned numeric, budget_actual numeric
) language plpgsql security definer stable set search_path = public as $$
declare
  v_family_id uuid;
  v_from timestamptz := p_month::timestamptz;
  v_to timestamptz := (p_month + interval '1 month')::timestamptz;
begin
  select family_id into v_family_id from public.profiles where id = auth.uid();
  if v_family_id is null then return; end if;
  return query
  select
    coalesce((select sum(a.balance) from public.accounts a where a.family_id = v_family_id), 0),
    coalesce((select sum(t.amount) from public.transactions t
              where t.family_id = v_family_id and t.type = 'income'
                and t.created_at >= v_from and t.created_at < v_to), 0),
    coalesce((select sum(t.amount) from public.transactions t
              where t.family_id = v_family_id and t.type = 'expense'
                and t.created_at >= v_from and t.created_at < v_to), 0),
    coalesce((select sum(l.remaining) from public.loans l
              where l.family_id = v_family_id and l.remaining > 0), 0),
    coalesce((select sum(b.monthly_limit) from public.budgets b
              where b.family_id = v_family_id and b.month = p_month), 0),
    coalesce((select sum(t.amount) from public.transactions t
              where t.family_id = v_family_id and t.type = 'expense'
                and t.created_at >= v_from and t.created_at < v_to
                and t.category in (select b.category from public.budgets b
                                   where b.family_id = v_family_id and b.month = p_month)), 0);
end;
$$;

-- ============================================================================
-- HOME OS ULTIMATE - Stage 2b: supervisor role, owner-only personal files,
-- family chat room schema.
-- ============================================================================

-- Roles: owner / supervisor / member
alter table public.profiles drop constraint profiles_role_check;

alter table public.profiles add constraint profiles_role_check
  check (role in ('owner','supervisor','member'));

alter table public.role_permissions drop constraint role_permissions_role_check;

alter table public.role_permissions add constraint role_permissions_role_check
  check (role in ('owner','supervisor','member'));
