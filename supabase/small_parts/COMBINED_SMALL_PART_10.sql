-- HOME OS PART 10 OF 34
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
