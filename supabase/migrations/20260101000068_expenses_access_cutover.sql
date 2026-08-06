-- Commercial-launch execution plan, Stage 1 cutover, table 5 of 8 (WORKLOG.md this date):
-- `expenses`. Direct, not-null `property_id` column -- same shape as `properties`/`units`/
-- `documents`. Write gate uses 'accountant'/'owner' (not 'property_manager') at the
-- property_access layer, matching the existing org-role gate here being 'accountant' (not
-- 'agent' like every other table cut over so far) -- expenses are specifically an accounting
-- action, and this table's own pre-existing role choice already reflects that; the property-level
-- gate should match it, not default to the same pattern as the other tables without checking.
-- Same defense-in-depth reasoning as `leases`/`documents`: apps/admin/app/api/v1/expenses/
-- route.ts's POST handler trusts `parsed.data.propertyId` directly. No bootstrapping problem
-- (verified against a real local database before writing this).
drop policy if exists "expenses_select_org_member" on public.expenses;
drop policy if exists "expenses_write_accountant_plus" on public.expenses;

create policy "expenses_select_org_member_and_property_access"
  on public.expenses for select
  using (public.has_org_role(org_id, 'viewer') and public.has_property_access(property_id, 'read_only'));

create policy "expenses_write_accountant_plus_and_property_access"
  on public.expenses for all
  using (
    public.has_org_role(org_id, 'accountant')
    and (public.has_property_access(property_id, 'accountant') or public.has_property_access(property_id, 'owner'))
  )
  with check (
    public.has_org_role(org_id, 'accountant')
    and (public.has_property_access(property_id, 'accountant') or public.has_property_access(property_id, 'owner'))
  );
