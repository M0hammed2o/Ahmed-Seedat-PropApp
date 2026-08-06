-- Closes TECHNICAL_DEBT_REGISTER.md TD-17: organizations.status has never been checked by
-- has_org_role() (verified by reading the live function source, 2026-08-03) -- suspending,
-- cancelling, or archiving an organization via OrganizationActionsPanel updates the row but has
-- had zero effect on that org's own members' data access. multi_tenant_isolation.test.sql
-- explicitly documented this as CURRENT BEHAVIOR, not a guarantee, and instructed that this exact
-- assertion must flip when the gap is closed -- that test file is updated in the same change.
--
-- Access model (PWA_V1_COMPLETION_PLAN.md #1 -- an ordinary access-control implementation
-- decision, inferable from SUPER_ADMIN.md's own language ("archived orgs retain full data for
-- compliance/audit... never a hard delete") and universal SaaS convention, not a business/legal
-- decision requiring sign-off):
--   trial, active, overdue -> unchanged, full role-based access (overdue is a billing grace
--     state -- SUPER_ADMIN.md never describes it as access-restricting, only suspend/archive are
--     documented as enforcement actions)
--   suspended, cancelled    -> forced to viewer-equivalent (read-only) regardless of the member's
--     stored role -- the org can still see its own data (to export it or resolve billing) but
--     cannot create or modify anything
--   archived                -> no access at all, even 'viewer' -- a Super Admin-only, more severe
--     action than suspend; data is retained for platform compliance/audit (service-role, which
--     bypasses RLS entirely, is unaffected), not for the org's own members to keep browsing
--
-- Single change point, matching this codebase's established pattern (e.g. TD-28's bearer-auth
-- fix): every call site already goes through has_org_role(), so no RLS policy or API route needs
-- to change -- the function signature is identical, only its body gains an organizations join and
-- a status branch.
create or replace function public.has_org_role(target_org_id uuid, min_role public.organization_member_role default 'viewer')
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
      and om.status = 'active'
      and o.status <> 'archived'
      and (
        case
          when o.status in ('suspended', 'cancelled') then min_role = 'viewer'
          else (
            case min_role
              when 'viewer' then true
              when 'accountant' then om.role in ('accountant', 'manager', 'principal')
              when 'agent' then om.role in ('agent', 'manager', 'principal')
              when 'manager' then om.role in ('manager', 'principal')
              when 'principal' then om.role = 'principal'
            end
          )
        end
      )
  );
$$;

comment on function public.has_org_role(uuid, public.organization_member_role) is
  'True if the calling authenticated user holds an active membership in target_org_id at or
   above min_role, AND the organization''s own status permits it: archived orgs grant no access
   at all; suspended/cancelled orgs grant viewer-only (read) access regardless of stored role;
   trial/active/overdue are unaffected (PWA_V1_COMPLETION_PLAN.md #1, TECHNICAL_DEBT_REGISTER.md
   TD-17). Note "accountant" and "agent" are siblings, not ranked against each other
   (PERMISSIONS.md §2 table) — each min_role check lists exactly the roles the calling code
   accepts.';
