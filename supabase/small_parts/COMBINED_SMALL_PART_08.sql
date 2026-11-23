-- HOME OS PART 08 OF 34
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
