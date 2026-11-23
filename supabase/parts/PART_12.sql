-- HOME OS PART 12 OF 12 (grants repair + family goals + daily check-ins).
-- Mirrors the hosted setup page exactly. Hardened: safe to re-run.

-- HOME OS ULTIMATE - PART 12: permissions repair + goals & check-ins.
-- The first three statements repair table permissions (the app needs them
-- to read data; row-level security still protects every row).
-- Then: family goals with progress tracking + daily check-ins.

-- Table grants: the app's direct table reads need these (RLS still applies per row).
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;

-- ============ FAMILY GOALS ============
create table if not exists public.family_goals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null,
  unit text not null default '',          -- e.g. EGP, kg, books, days
  target_value numeric not null check (target_value > 0),
  deadline date,
  status text not null default 'active' check (status in ('active', 'achieved', 'archived')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.goal_progress (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.family_goals(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric not null check (amount <> 0),
  note text not null default '',
  created_at timestamptz not null default now()
);

-- Progress total helper: sum of contributions for a goal.
create or replace function public.goal_total(p_goal_id uuid)
returns numeric language sql security definer stable set search_path = public as $$
  select coalesce(sum(amount), 0) from public.goal_progress where goal_id = p_goal_id;
$$;

-- Auto-mark achieved when progress reaches the target (keeps status truthful).
create or replace function public.goal_mark_achieved()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_goal public.family_goals%rowtype;
begin
  select * into v_goal from public.family_goals where id = new.goal_id;
  if v_goal.status = 'active' and public.goal_total(new.goal_id) >= v_goal.target_value then
    update public.family_goals set status = 'achieved' where id = new.goal_id;
  end if;
  return new;
end;
$$;

drop trigger if exists goal_progress_mark_achieved on public.goal_progress;
create trigger goal_progress_mark_achieved
  after insert on public.goal_progress
  for each row execute function public.goal_mark_achieved();

alter table public.family_goals enable row level security;
alter table public.goal_progress enable row level security;

drop policy if exists goals_select on public.family_goals;
create policy goals_select on public.family_goals for select
  using (public.is_family_member(family_id));
drop policy if exists goals_insert on public.family_goals;
create policy goals_insert on public.family_goals for insert
  with check (public.is_family_member(family_id) and created_by = auth.uid());
drop policy if exists goals_update on public.family_goals;
create policy goals_update on public.family_goals for update
  using (public.is_family_member(family_id));
drop policy if exists goals_delete on public.family_goals;
create policy goals_delete on public.family_goals for delete
  using (created_by = auth.uid() or public.is_family_owner(family_id));

drop policy if exists goal_progress_select on public.goal_progress;
create policy goal_progress_select on public.goal_progress for select
  using (exists (
    select 1 from public.family_goals g
    where g.id = goal_id and public.is_family_member(g.family_id)
  ));
drop policy if exists goal_progress_insert on public.goal_progress;
create policy goal_progress_insert on public.goal_progress for insert
  with check (member_id = auth.uid() and exists (
    select 1 from public.family_goals g
    where g.id = goal_id and public.is_family_member(g.family_id)
  ));
drop policy if exists goal_progress_delete_own on public.goal_progress;
create policy goal_progress_delete_own on public.goal_progress for delete
  using (member_id = auth.uid());

-- ============ DAILY CHECK-INS ============
create table if not exists public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  checkin_date date not null default current_date,
  mood text not null check (mood in ('great', 'good', 'okay', 'tired', 'stressed', 'sad')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, member_id, checkin_date)
);

alter table public.daily_checkins enable row level security;

drop policy if exists checkins_select on public.daily_checkins;
create policy checkins_select on public.daily_checkins for select
  using (public.is_family_member(family_id));
drop policy if exists checkins_insert on public.daily_checkins;
create policy checkins_insert on public.daily_checkins for insert
  with check (member_id = auth.uid() and public.is_family_member(family_id));
drop policy if exists checkins_update_own on public.daily_checkins;
create policy checkins_update_own on public.daily_checkins for update
  using (member_id = auth.uid()) with check (member_id = auth.uid());
drop policy if exists checkins_delete_own on public.daily_checkins;
create policy checkins_delete_own on public.daily_checkins for delete
  using (member_id = auth.uid());


-- Final grant pass so the new tables are covered too.
grant select, insert, update, delete on all tables in schema public to authenticated;

select 'HOME OS ULTIMATE: database ready ✅' as status,
       (select count(*) from pg_tables where schemaname = 'public') as tables,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public') as functions;
