-- HOME OS PART 11 OF 34
-- Audit log: family members read; only functions insert (no client policy).
create policy audit_logs_select on public.audit_logs for select
  using (family_id is not null and public.is_family_member(family_id));

-- Finance
create policy accounts_select on public.accounts for select using (public.is_family_member(family_id));

create policy accounts_write on public.accounts for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

create policy transactions_select on public.transactions for select using (public.is_family_member(family_id));

create policy transactions_insert on public.transactions for insert
  with check (public.is_family_member(family_id) and public.has_permission('finance.manage'));

create policy budgets_all on public.budgets for all
  using (public.is_family_member(family_id) and public.has_permission('finance.manage'))
  with check (public.is_family_member(family_id) and public.has_permission('finance.manage'));

create policy loans_select on public.loans for select using (public.is_family_member(family_id));

create policy loans_write on public.loans for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

create policy payments_select on public.payments for select using (public.is_family_member(family_id));

create policy payments_insert on public.payments for insert
  with check (public.is_family_member(family_id) and public.has_permission('finance.manage'));

create policy salaries_select on public.salaries for select
  using (public.is_family_owner(family_id) or profile_id = auth.uid());

create policy salaries_write on public.salaries for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

-- Requests: members create their own and read the family's; owners decide via update.
create policy requests_select on public.requests for select using (public.is_family_member(family_id));

create policy requests_insert on public.requests for insert
  with check (public.is_family_member(family_id) and requester_id = auth.uid());

create policy requests_update_owner on public.requests for update
  using (public.is_family_owner(family_id));

-- Tasks
create policy tasks_select on public.tasks for select using (public.is_family_member(family_id));

create policy tasks_insert on public.tasks for insert
  with check (public.is_family_member(family_id) and created_by = auth.uid());

create policy tasks_update on public.tasks for update using (public.is_family_member(family_id));

-- Calendar
create policy calendar_select on public.calendar_events for select using (public.is_family_member(family_id));

create policy calendar_write on public.calendar_events for all
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
