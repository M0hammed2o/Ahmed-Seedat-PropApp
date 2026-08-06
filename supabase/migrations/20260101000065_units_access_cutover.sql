-- Commercial-launch execution plan, Stage 1 cutover, table 2 of 8 (WORKLOG.md this date): `units`.
-- Simpler than `properties` -- a unit's parent property (and therefore the creator's
-- property_access grant on it) always already exists before a unit can be created, since the API
-- route (apps/admin/app/api/v1/properties/[id]/units/route.ts) requires the caller to already see
-- the property via `loadVisibleProperty()` before reaching the insert. No bootstrapping problem,
-- no auto-grant trigger needed, no RPC needed -- verified against a real local database (the exact
-- `INSERT ... RETURNING` pattern the API route uses) before writing this migration, same standard
-- as the properties cutover.
drop policy if exists "units_select_org_member" on public.units;
drop policy if exists "units_write_agent_plus" on public.units;

create policy "units_select_org_member_and_property_access"
  on public.units for select
  using (public.has_org_role(org_id, 'viewer') and public.has_property_access(property_id, 'read_only'));

create policy "units_write_agent_plus_and_property_access"
  on public.units for all
  using (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'property_manager') or public.has_property_access(property_id, 'owner'))
  )
  with check (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'property_manager') or public.has_property_access(property_id, 'owner'))
  );
