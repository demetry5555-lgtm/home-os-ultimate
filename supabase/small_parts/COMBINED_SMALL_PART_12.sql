-- HOME OS PART 12 OF 34
-- Apartment: members read, owner manages.
create policy apartments_select on public.apartments for select using (public.is_family_member(family_id));

create policy apartments_write on public.apartments for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

create policy rooms_select on public.rooms for select
  using (exists (select 1 from public.apartments a where a.id = apartment_id and public.is_family_member(a.family_id)));

create policy rooms_write on public.rooms for all
  using (exists (select 1 from public.apartments a where a.id = apartment_id and public.is_family_owner(a.family_id)));

create policy finishing_select on public.finishing_stages for select
  using (exists (select 1 from public.rooms r join public.apartments a on a.id = r.apartment_id
                 where r.id = room_id and public.is_family_member(a.family_id)));

create policy finishing_write on public.finishing_stages for all
  using (exists (select 1 from public.rooms r join public.apartments a on a.id = r.apartment_id
                 where r.id = room_id and public.is_family_owner(a.family_id)));

create policy assets_select on public.assets for select using (public.is_family_member(family_id));

create policy assets_write on public.assets for all
  using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));

create policy maintenance_select on public.maintenance for select using (public.is_family_member(family_id));

create policy maintenance_write on public.maintenance for all
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));

-- Documents: metadata is family-visible; the storage bucket stays private and
-- files are served only via short-lived signed URLs.
create policy documents_select on public.documents for select using (public.is_family_member(family_id));

create policy documents_insert on public.documents for insert
  with check (public.is_family_member(family_id) and owner_id = auth.uid());

create policy documents_delete on public.documents for delete
  using (owner_id = auth.uid() or public.is_family_owner(family_id));

-- Notifications: strictly per-recipient.
create policy notifications_select on public.notifications for select using (profile_id = auth.uid());

create policy notifications_update on public.notifications for update using (profile_id = auth.uid());
