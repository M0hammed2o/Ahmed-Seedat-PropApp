-- RELEASE A P0 SECURITY FIX (V1 Commercial Launch Gap Audit, this date): re-verified by directly
-- reading has_org_role() (20260101000055) and both billing routes (apps/admin/app/api/v1/
-- organizations/[orgId]/billing/{checkout,cancel}/route.ts) -- a suspended/cancelled organization's
-- own PRINCIPAL genuinely cannot reactivate billing today. has_org_role()'s status branch forces
-- `min_role = 'viewer'` unconditionally whenever `o.status in ('suspended','cancelled')`, and both
-- billing routes call `requireOrgRole(supabase, orgId, 'principal')` with no exemption -- so
-- `has_org_role(orgId, 'principal')` always returns false for exactly the customer who most needs
-- to pay again. The billing PAGE itself still renders (its own reads only need viewer-level
-- access), so the customer sees their plans and a "Subscribe" button whose click returns a bare
-- 403 -- looking broken, not suspended-with-a-reason.
--
-- Fix: a genuinely narrow, purpose-built authorization primitive, NOT a change to
-- has_org_role()'s own semantics (which correctly stay unchanged for every other route -- a
-- suspended org's principal must still be unable to create a property, invite staff, edit a
-- tenant, etc.). has_billing_principal_access() checks exactly what the task requires: real
-- authentication, an ACTIVE membership row, that membership's role is literally 'principal' (not
-- manager, not "principal-or-above" -- there is nothing above principal), the organization ID
-- matches, and archived orgs are still excluded (archiving is a strictly more severe, Super-Admin-
-- only action than suspend/cancel -- out of scope for self-service reactivation, preserving
-- SUPER_ADMIN.md's own architecture). It deliberately has NO status branch at all for
-- suspended/cancelled -- that omission IS the fix.

create or replace function public.has_billing_principal_access(target_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.organization_members om
    join public.organizations o on o.id = om.org_id
    where om.org_id = target_org_id
      and om.user_id = auth.uid()
      and om.role = 'principal'
      and om.status = 'active'
      and o.status <> 'archived'
  );
$$;

comment on function public.has_billing_principal_access(uuid) is
  'RELEASE A P0 fix: narrow, billing-route-only authorization -- true iff the calling authenticated
   user holds an ACTIVE membership on target_org_id with role exactly ''principal'', and the org is
   not archived. Deliberately does NOT consult organizations.status the way has_org_role() does --
   a suspended/cancelled org''s principal is exactly who this function exists to keep authorized, so
   they can start a new checkout or a legitimate cancellation. Use ONLY for the billing
   checkout/cancel/reactivation routes; every other org mutation must keep using has_org_role(),
   which correctly continues to force suspended/cancelled orgs to viewer-only. Archived orgs are
   still excluded here too -- archiving is a Super-Admin-only action out of scope for self-service
   billing.';

revoke all on function public.has_billing_principal_access(uuid) from public;
grant execute on function public.has_billing_principal_access(uuid) to authenticated;
