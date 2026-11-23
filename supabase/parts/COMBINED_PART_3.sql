-- HOME OS PART 3 OF 7
-- Run only after part 2 has completed successfully.

-- Accept an invitation with its code. Atomic: claim + profile join in one
-- transaction; the code is single-use and expires.
create or replace function public.accept_invitation(p_code text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'profile already exists';
  end if;
  select * into v_inv from public.invitations
  where code_hash = encode(digest(upper(trim(p_code)), 'sha256'), 'hex')
  for update;                                    -- lock the row: single-use
  if not found then
    raise exception 'invalid invitation code';
  end if;
  if v_inv.status = 'pending' and v_inv.expires_at < now() then
    update public.invitations set status = 'expired' where id = v_inv.id;
    raise exception 'invitation expired';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'invitation already used or revoked';
  end if;
  insert into public.profiles (id, full_name, family_id, role)
  values (auth.uid(), p_full_name, v_inv.family_id, 'member');
  update public.invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_inv.id;
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id)
  values (v_inv.family_id, auth.uid(), 'invitation.accept', 'invitations', v_inv.id::text);
  return v_inv.family_id;
end;
$$;

-- Revoke an invitation (owner of its family only, and only while pending).
create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
begin
  select family_id into v_family_id from public.invitations where id = p_invitation_id;
  if v_family_id is null or not public.is_family_owner(v_family_id) then
    raise exception 'not allowed';
  end if;
  update public.invitations set status = 'revoked'
  where id = p_invitation_id and status = 'pending';
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id)
  values (v_family_id, auth.uid(), 'invitation.revoke', 'invitations', p_invitation_id::text);
end;
$$;

-- Suspend or reactivate a member (owner only; cannot suspend an owner).
create or replace function public.set_member_status(p_profile_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target public.profiles%rowtype;
begin
  select * into v_target from public.profiles where id = p_profile_id;
  if not found or not public.is_family_owner(v_target.family_id) then
    raise exception 'not allowed';
  end if;
  if v_target.role = 'owner' then
    raise exception 'cannot suspend the owner';
  end if;
  if p_status not in ('active','suspended') then
    raise exception 'invalid status';
  end if;
  update public.profiles set status = p_status where id = p_profile_id;
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id, metadata)
  values (v_target.family_id, auth.uid(), 'member.status', 'profiles',
          p_profile_id::text, jsonb_build_object('status', p_status));
end;
$$;

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
create policy permissions_read on public.permissions for select using (auth.uid() is not null);
create policy role_permissions_read on public.role_permissions for select using (auth.uid() is not null);

-- Profiles: family members see each other; you always see and edit yourself.
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_family_member(family_id));
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

-- Families: members can read; only owner can update.
create policy families_select on public.families for select using (public.is_family_member(id));
create policy families_update_owner on public.families for update using (public.is_family_owner(id));

-- Invitations: only the family owner reads the list; writes go through the
-- security-definer functions (create_invitation / accept / revoke).
create policy invitations_select_owner on public.invitations for select
  using (public.is_family_owner(family_id));

-- Session events: you read and insert only your own.
create policy session_events_select on public.session_events for select using (user_id = auth.uid());
create policy session_events_insert on public.session_events for insert with check (user_id = auth.uid());

-- Audit log: family members read; only functions insert (no client policy).
create policy audit_logs_select on public.audit_logs for select
  using (family_id is not null and public.is_family_member(family_id));

-- Finance
create policy accounts_select on public.accounts for select using (public.is_family_member(family_id));
create policy accounts_write on public.accounts for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

create policy transactions_select on public.transactions for select using (public.is_family_member(family_id));
