-- HOME OS PART 07 OF 34
-- Create an invitation. Owner only. Returns the plaintext code ONCE;
-- only its sha256 hash and last-4 hint are stored.
create or replace function public.create_invitation(p_intended_name text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
  v_code text;
begin
  select family_id into v_family_id from public.profiles
  where id = auth.uid() and role = 'owner' and status = 'active';
  if v_family_id is null then
    raise exception 'only an active owner can create invitations';
  end if;
  v_code := 'HOME-' ||
            upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 4)) || '-' ||
            upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 4));
  insert into public.invitations
    (family_id, code_hash, code_hint, intended_name, created_by)
  values
    (v_family_id, encode(digest(v_code, 'sha256'), 'hex'),
     right(v_code, 4), p_intended_name, auth.uid());
  insert into public.audit_logs (family_id, actor_id, action, entity, metadata)
  values (v_family_id, auth.uid(), 'invitation.create', 'invitations',
          jsonb_build_object('hint', right(v_code, 4)));
  return v_code;
end;
$$;

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
