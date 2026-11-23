-- HOME OS PART 06 OF 34
-- ============================================================================
-- Helper functions (security definer where they must cross RLS)
-- ============================================================================

-- Is the current user an active member of the given family?
create or replace function public.is_family_member(p_family_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and family_id = p_family_id and status = 'active'
  );
$$;

-- Is the current user the active owner of the given family?
create or replace function public.is_family_owner(p_family_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and family_id = p_family_id
      and role = 'owner' and status = 'active'
  );
$$;

-- Does the current user hold a permission within their family?
create or replace function public.has_permission(p_key text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role = p.role
    where p.id = auth.uid() and p.status = 'active'
      and rp.permission_key = p_key
  );
$$;

-- First-run owner bootstrap: creates the family and makes the caller owner.
-- No hardcoded credentials: the caller is whoever just signed up in Auth.
create or replace function public.bootstrap_owner(p_owner_name text, p_family_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'profile already exists';
  end if;
  insert into public.profiles (id, full_name, role)
  values (auth.uid(), p_owner_name, 'owner');
  insert into public.families (name, owner_id) values (p_family_name, auth.uid())
  returning id into v_family_id;
  update public.profiles set family_id = v_family_id where id = auth.uid();
  insert into public.audit_logs (family_id, actor_id, action, entity, entity_id)
  values (v_family_id, auth.uid(), 'family.bootstrap', 'families', v_family_id::text);
  return v_family_id;
end;
$$;
