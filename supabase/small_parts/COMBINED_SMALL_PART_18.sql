-- HOME OS PART 18 OF 34
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
