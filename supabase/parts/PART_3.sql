-- HOME OS PART 3 OF 10 (part 9B is the repair for part 9)
-- Mirrors the hosted setup page exactly. Hardened: safe to re-run any part.

-- HOME OS PART 3 OF 9
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

alter table public.audit_logs        enable row level security;

alter table public.accounts          enable row level security;

alter table public.transactions      enable row level security;

alter table public.budgets           enable row level security;

alter table public.loans             enable row level security;

alter table public.payments          enable row level security;

alter table public.salaries          enable row level security;

alter table public.requests          enable row level security;

alter table public.tasks             enable row level security;

alter table public.calendar_events   enable row level security;

alter table public.apartments        enable row level security;

alter table public.rooms             enable row level security;

alter table public.finishing_stages  enable row level security;

alter table public.assets            enable row level security;

alter table public.maintenance       enable row level security;

alter table public.documents         enable row level security;

alter table public.notifications     enable row level security;

alter table public.permissions       enable row level security;

alter table public.role_permissions  enable row level security;

-- Reference data: readable by any signed-in user, never writable from clients.
drop policy if exists permissions_read on public.permissions;
create policy permissions_read on public.permissions for select using (auth.uid() is not null);

drop policy if exists role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions for select using (auth.uid() is not null);

-- Profiles: family members see each other; you always see and edit yourself.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_family_member(family_id));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

-- Families: members can read; only owner can update.
drop policy if exists families_select on public.families;
create policy families_select on public.families for select using (public.is_family_member(id));

drop policy if exists families_update_owner on public.families;
create policy families_update_owner on public.families for update using (public.is_family_owner(id));

-- Invitations: only the family owner reads the list; writes go through the
-- security-definer functions (create_invitation / accept / revoke).
drop policy if exists invitations_select_owner on public.invitations;
create policy invitations_select_owner on public.invitations for select
  using (public.is_family_owner(family_id));

-- Session events: you read and insert only your own.
drop policy if exists session_events_select on public.session_events;
create policy session_events_select on public.session_events for select using (user_id = auth.uid());

drop policy if exists session_events_insert on public.session_events;
create policy session_events_insert on public.session_events for insert with check (user_id = auth.uid());

-- Audit log: family members read; only functions insert (no client policy).
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select
  using (family_id is not null and public.is_family_member(family_id));

-- Finance
drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts for select using (public.is_family_member(family_id));

drop policy if exists accounts_write on public.accounts;
create policy accounts_write on public.accounts for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions for select using (public.is_family_member(family_id));

drop policy if exists transactions_insert on public.transactions;
create policy transactions_insert on public.transactions for insert
  with check (public.is_family_member(family_id) and public.has_permission('finance.manage'));

drop policy if exists budgets_all on public.budgets;
create policy budgets_all on public.budgets for all
  using (public.is_family_member(family_id) and public.has_permission('finance.manage'))
  with check (public.is_family_member(family_id) and public.has_permission('finance.manage'));

drop policy if exists loans_select on public.loans;
create policy loans_select on public.loans for select using (public.is_family_member(family_id));

drop policy if exists loans_write on public.loans;
create policy loans_write on public.loans for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select using (public.is_family_member(family_id));

drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments for insert
  with check (public.is_family_member(family_id) and public.has_permission('finance.manage'));

drop policy if exists salaries_select on public.salaries;
create policy salaries_select on public.salaries for select
  using (public.is_family_owner(family_id) or profile_id = auth.uid());

drop policy if exists salaries_write on public.salaries;
create policy salaries_write on public.salaries for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

-- Requests: members create their own and read the family's; owners decide via update.
drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select using (public.is_family_member(family_id));

drop policy if exists requests_insert on public.requests;
create policy requests_insert on public.requests for insert
  with check (public.is_family_member(family_id) and requester_id = auth.uid());

drop policy if exists requests_update_owner on public.requests;
create policy requests_update_owner on public.requests for update
  using (public.is_family_owner(family_id));

-- Tasks
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select using (public.is_family_member(family_id));

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert
  with check (public.is_family_member(family_id) and created_by = auth.uid());

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update using (public.is_family_member(family_id));

-- Calendar
drop policy if exists calendar_select on public.calendar_events;
create policy calendar_select on public.calendar_events for select using (public.is_family_member(family_id));

drop policy if exists calendar_write on public.calendar_events;
create policy calendar_write on public.calendar_events for all
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));

-- Apartment: members read, owner manages.
drop policy if exists apartments_select on public.apartments;
create policy apartments_select on public.apartments for select using (public.is_family_member(family_id));

drop policy if exists apartments_write on public.apartments;
create policy apartments_write on public.apartments for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms for select
  using (exists (select 1 from public.apartments a where a.id = apartment_id and public.is_family_member(a.family_id)));

drop policy if exists rooms_write on public.rooms;
create policy rooms_write on public.rooms for all
  using (exists (select 1 from public.apartments a where a.id = apartment_id and public.is_family_owner(a.family_id)));

drop policy if exists finishing_select on public.finishing_stages;
create policy finishing_select on public.finishing_stages for select
  using (exists (select 1 from public.rooms r join public.apartments a on a.id = r.apartment_id
                 where r.id = room_id and public.is_family_member(a.family_id)));

drop policy if exists finishing_write on public.finishing_stages;
create policy finishing_write on public.finishing_stages for all
  using (exists (select 1 from public.rooms r join public.apartments a on a.id = r.apartment_id
                 where r.id = room_id and public.is_family_owner(a.family_id)));

drop policy if exists assets_select on public.assets;
create policy assets_select on public.assets for select using (public.is_family_member(family_id));

drop policy if exists assets_write on public.assets;
create policy assets_write on public.assets for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

drop policy if exists maintenance_select on public.maintenance;
create policy maintenance_select on public.maintenance for select using (public.is_family_member(family_id));

drop policy if exists maintenance_write on public.maintenance;
create policy maintenance_write on public.maintenance for all
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));

-- Documents: metadata is family-visible; the storage bucket stays private and
-- files are served only via short-lived signed URLs.
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select using (public.is_family_member(family_id));

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert
  with check (public.is_family_member(family_id) and owner_id = auth.uid());

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete
  using (owner_id = auth.uid() or public.is_family_owner(family_id));

-- Notifications: strictly per-recipient.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select using (profile_id = auth.uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update using (profile_id = auth.uid());
