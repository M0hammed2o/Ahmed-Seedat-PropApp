-- Commercial-launch execution plan, Stage 1 cutover, table 3 of 8 (WORKLOG.md this date): `leases`
-- + `lease_tenants`. Unlike `properties`/`units`, `leases` has no direct `property_id` column --
-- only `unit_id` -- so has_property_access() is reached through a join to `units`. Same
-- no-bootstrapping-problem reasoning as `units` (the unit, and the property_access grants on its
-- property, always already exist before a lease can reference it) -- verified against a real
-- local database before writing this, same standard as the previous two tables.
--
-- One real gap closed here that the previous two tables didn't have: `apps/admin/app/api/v1/
-- leases/route.ts`'s POST handler trusts `parsed.data.unitId` directly with no prior
-- "can the caller actually see this unit" check (unlike the units-creation route, which calls
-- `loadVisibleProperty()` first) -- org role alone was the only gate. The WITH CHECK below closes
-- that: a lease referencing a unit the caller has no property_access to now fails at the database
-- layer regardless of what the route itself validates.
drop policy if exists "leases_select_org_member" on public.leases;
drop policy if exists "leases_write_agent_plus" on public.leases;

create policy "leases_select_org_member_and_property_access"
  on public.leases for select
  using (
    public.has_org_role(org_id, 'viewer')
    and exists (
      select 1 from public.units u
      where u.id = leases.unit_id and public.has_property_access(u.property_id, 'read_only')
    )
  );

create policy "leases_write_agent_plus_and_property_access"
  on public.leases for all
  using (
    public.has_org_role(org_id, 'agent')
    and exists (
      select 1 from public.units u
      where u.id = leases.unit_id
        and (public.has_property_access(u.property_id, 'property_manager') or public.has_property_access(u.property_id, 'owner'))
    )
  )
  with check (
    public.has_org_role(org_id, 'agent')
    and exists (
      select 1 from public.units u
      where u.id = leases.unit_id
        and (public.has_property_access(u.property_id, 'property_manager') or public.has_property_access(u.property_id, 'owner'))
    )
  );

-- lease_tenants: pure join table, scoped through leases (same pattern as property_owners scoped
-- through owners.org_id) -- now transitively also scoped through leases' own property_access
-- requirement above, with no changes needed to lease_tenants' own policies (they already delegate
-- entirely to a `leases` row satisfying has_org_role(); that same row now also requires
-- has_property_access(), so lease_tenants inherits the restriction automatically). No migration
-- change needed here -- documented, not silently assumed, and confirmed by this migration's own
-- pgTAP test asserting lease_tenants visibility narrows exactly when leases visibility does.
