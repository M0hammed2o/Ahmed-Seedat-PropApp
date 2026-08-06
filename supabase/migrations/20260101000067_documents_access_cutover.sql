-- Commercial-launch execution plan, Stage 1 cutover, table 4 of 8 (WORKLOG.md this date):
-- `documents`. Has a direct, not-null `property_id` column (20260101000008) -- same direct-join
-- shape as `properties`/`units`, no join through another table needed. Same defense-in-depth gap
-- as `leases`: `apps/admin/app/api/v1/documents/route.ts`'s POST handler trusts
-- `parsed.data.propertyId` directly with no prior visibility check -- the WITH CHECK below closes
-- that at the database layer. No bootstrapping problem (the property, and the uploader's
-- property_access grant on it, always already exists first) -- verified against a real local
-- database before writing this, same standard as the previous three tables.
drop policy if exists "documents_select_org_member" on public.documents;
drop policy if exists "documents_write_agent_plus" on public.documents;

create policy "documents_select_org_member_and_property_access"
  on public.documents for select
  using (public.has_org_role(org_id, 'viewer') and public.has_property_access(property_id, 'read_only'));

create policy "documents_write_agent_plus_and_property_access"
  on public.documents for all
  using (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'property_manager') or public.has_property_access(property_id, 'owner'))
  )
  with check (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'property_manager') or public.has_property_access(property_id, 'owner'))
  );
