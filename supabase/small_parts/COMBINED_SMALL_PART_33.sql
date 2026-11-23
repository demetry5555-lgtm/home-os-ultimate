-- HOME OS PART 33 OF 34
create policy rooms_write on public.rooms for all
  using (exists (select 1 from public.apartments a where a.id = apartment_id
                 and public.is_family_member(a.family_id) and public.has_permission('apartment.manage')))
  with check (exists (select 1 from public.apartments a where a.id = apartment_id
                 and public.is_family_member(a.family_id) and public.has_permission('apartment.manage')));

drop policy finishing_write on public.finishing_stages;

create policy finishing_write on public.finishing_stages for all
  using (exists (select 1 from public.rooms r join public.apartments a on a.id = r.apartment_id
                 where r.id = room_id and public.is_family_member(a.family_id)
                 and public.has_permission('apartment.manage')))
  with check (exists (select 1 from public.rooms r join public.apartments a on a.id = r.apartment_id
                 where r.id = room_id and public.is_family_member(a.family_id)
                 and public.has_permission('apartment.manage')));

drop policy assets_write on public.assets;

create policy assets_write on public.assets for all
  using (public.is_family_member(family_id) and public.has_permission('assets.manage'))
  with check (public.is_family_member(family_id) and public.has_permission('assets.manage'));

create policy suppliers_select on public.suppliers for select using (public.is_family_member(family_id));

create policy suppliers_write on public.suppliers for all
  using (public.is_family_member(family_id) and public.has_permission('apartment.manage'))
  with check (public.is_family_member(family_id) and public.has_permission('apartment.manage'));

drop policy if exists maintenance_write on public.maintenance;

create policy maintenance_write on public.maintenance for all
  using (public.is_family_member(family_id) and public.has_permission('assets.manage'))
  with check (public.is_family_member(family_id) and public.has_permission('assets.manage'));

-- ---------------------------------------------------------------------------
-- record_expense: now accepts apartment tags (room/stage/maintenance) so
-- spending links live into the apartment budget. Same single-transaction
-- semantics as stage 2.
-- ---------------------------------------------------------------------------
drop function public.record_expense(uuid, numeric, text, text, text, uuid);
