-- HOME OS PART 17 OF 34
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
