-- Commercial-launch execution plan, Stage 1 cutover, table 7 of 8 (WORKLOG.md this date):
-- `maintenance_tickets`. Direct, not-null `property_id` column -- same shape as
-- `properties`/`units`/`documents`/`expenses`. Write gate uses 'maintenance_manager'/'owner' at
-- the property_access layer, matching the domain (maintenance is its own named property_role,
-- distinct from property_manager/accountant). Same defense-in-depth reasoning as the other
-- direct-property_id tables: apps/admin/app/api/v1/maintenance-tickets/route.ts's POST handler
-- trusts `parsed.data.propertyId` directly. The separate tenant-self select/insert policies
-- (20260101000049) are untouched -- independent PERMISSIVE policies, OR'd together with the ones
-- below, not affected by this change. No bootstrapping problem (verified against a real local
-- database before writing this).
drop policy if exists "maintenance_tickets_select_org_member" on public.maintenance_tickets;
drop policy if exists "maintenance_tickets_write_agent_plus" on public.maintenance_tickets;

create policy "maintenance_tickets_select_org_member_and_property_access"
  on public.maintenance_tickets for select
  using (public.has_org_role(org_id, 'viewer') and public.has_property_access(property_id, 'read_only'));

create policy "maintenance_tickets_write_agent_plus_and_property_access"
  on public.maintenance_tickets for all
  using (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'maintenance_manager') or public.has_property_access(property_id, 'owner'))
  )
  with check (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'maintenance_manager') or public.has_property_access(property_id, 'owner'))
  );
