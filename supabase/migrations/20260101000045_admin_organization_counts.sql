-- TASKS.md M19: batched per-org counts for the Super Admin client directory
-- (SUPER_ADMIN.md §3: properties/units/owners/tenants/staff counts per row). A plain
-- PostgREST/supabase-js query can't express a GROUP BY across five tables for an arbitrary batch
-- of org ids, so this is a small SQL function instead -- matches the existing pattern for any
-- cross-table read the client library can't express directly (has_org_role(),
-- tenant_can_view_property_announcement(), resolve_whatsapp_sender()).
--
-- Unscoped by caller identity (it takes a bare array of org ids, like resolve_whatsapp_sender()
-- took a bare phone number) -- applying the lesson from that function's EXECUTE-grant
-- vulnerability (DECISIONS.md 2026-07-31, RISK_REGISTER.md R-23) proactively this time: revoke
-- EXECUTE from anon/authenticated immediately, before this migration is ever committed, rather
-- than discovering the same class of gap again later. Only service_role (every Super Admin route
-- handler's execution context, gated by requireRole() before this is ever called) may call it.
create or replace function public.admin_organization_counts(p_org_ids uuid[])
returns table (
  org_id uuid,
  properties_count bigint,
  units_count bigint,
  owners_count bigint,
  tenants_count bigint,
  staff_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    o.id as org_id,
    (select count(*) from public.properties p where p.org_id = o.id) as properties_count,
    (select count(*) from public.units u where u.org_id = o.id) as units_count,
    (select count(*) from public.owners ow where ow.org_id = o.id) as owners_count,
    (select count(*) from public.tenants t where t.org_id = o.id) as tenants_count,
    (select count(*) from public.organization_members om where om.org_id = o.id and om.status = 'active') as staff_count
  from public.organizations o
  where o.id = any(p_org_ids);
$$;

revoke execute on function public.admin_organization_counts(uuid[]) from public, anon, authenticated;
