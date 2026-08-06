-- Commercial-launch execution plan, Stage 3 (Phase 5 — Owner Portal, WORKLOG.md this date):
-- revises every Stage 1 SELECT policy to let a genuine co-owner (an `owners` row with
-- `user_id` set, holding an 'owner'-role property_access grant, but NO organization_members row
-- at all -- the actual target user of this phase) see their own property's data.
--
-- Found while building the owner portal itself, not assumed safe from the Stage 1 design: every
-- SELECT policy cut over in Stage 1 requires `has_org_role(org_id, 'viewer') AND
-- has_property_access(property_id, 'read_only')` -- both halves. A real owner with no staff role
-- in the org fails the has_org_role() half unconditionally, meaning they could never see their
-- own property, units, leases, documents, expenses, journal_lines, or maintenance tickets through
-- the owner portal at all. The fix: OR in a second, narrower path -- an 'owner'-role
-- property_access grant is sufficient on its own, independent of org membership. Staff visibility
-- (the AND'd org-role + property-access path) is completely unchanged.
--
-- owner_statements needed no change -- it already has its own owner-self-access branch
-- (owner_statements_select_org_or_self, 20260101000037), predating this phase.

drop policy if exists "properties_select_org_member_and_property_access" on public.properties;
create policy "properties_select_staff_or_owner"
  on public.properties for select
  using (
    (public.has_org_role(org_id, 'viewer') and public.has_property_access(id, 'read_only'))
    or public.has_property_access(id, 'owner')
  );

drop policy if exists "units_select_org_member_and_property_access" on public.units;
create policy "units_select_staff_or_owner"
  on public.units for select
  using (
    (public.has_org_role(org_id, 'viewer') and public.has_property_access(property_id, 'read_only'))
    or public.has_property_access(property_id, 'owner')
  );

drop policy if exists "leases_select_org_member_and_property_access" on public.leases;
create policy "leases_select_staff_or_owner"
  on public.leases for select
  using (
    exists (
      select 1 from public.units u
      where u.id = leases.unit_id
        and (
          (public.has_org_role(leases.org_id, 'viewer') and public.has_property_access(u.property_id, 'read_only'))
          or public.has_property_access(u.property_id, 'owner')
        )
    )
  );

drop policy if exists "documents_select_org_member_and_property_access" on public.documents;
create policy "documents_select_staff_or_owner"
  on public.documents for select
  using (
    (public.has_org_role(org_id, 'viewer') and public.has_property_access(property_id, 'read_only'))
    or public.has_property_access(property_id, 'owner')
  );

drop policy if exists "expenses_select_org_member_and_property_access" on public.expenses;
create policy "expenses_select_staff_or_owner"
  on public.expenses for select
  using (
    (public.has_org_role(org_id, 'viewer') and public.has_property_access(property_id, 'read_only'))
    or public.has_property_access(property_id, 'owner')
  );

-- journal_lines is a genuine exception to the OR-in-an-owner-path pattern above: an owner should
-- see lines belonging to THEIR property, but the existing policy's org-membership half also
-- gates lines with property_id IS NULL (org-level lines like bank/equity postings an owner has no
-- business seeing at all, unlike a real org viewer). Rather than silently exposing every
-- no-property-id line to any owner of any property in the org, this migration adds owner access
-- as its own, separate, narrower policy -- a second PERMISSIVE policy that only ever matches
-- property-tagged lines the owner actually holds an 'owner' grant on, never the org-level ones.
create policy "journal_lines_select_owner_property_only"
  on public.journal_lines for select
  using (
    journal_lines.property_id is not null
    and public.has_property_access(journal_lines.property_id, 'owner')
  );

drop policy if exists "maintenance_tickets_select_org_member_and_property_access" on public.maintenance_tickets;
create policy "maintenance_tickets_select_staff_or_owner"
  on public.maintenance_tickets for select
  using (
    (public.has_org_role(org_id, 'viewer') and public.has_property_access(property_id, 'read_only'))
    or public.has_property_access(property_id, 'owner')
  );
