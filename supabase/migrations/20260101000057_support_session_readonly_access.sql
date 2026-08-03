-- PWA_V1_COMPLETION_PLAN.md #12, closing TD-25 now that M20's client-facing (dashboard) routes
-- are real (TD-25's own text: "build the scoping/escalation logic alongside the client-facing
-- routes it would apply to, not before" -- that milestone has now shipped across this session).
--
-- Scope, matching SUPER_ADMIN.md §6 exactly: item 1 ("read-only by default") is what this
-- migration implements. Item 2 ("explicit escalation per write", logged to
-- support_access_sessions.actions_taken) is a materially separate mechanism -- a per-write
-- opt-in across every mutating endpoint in the app -- and is NOT built here; this closes the
-- read-only half honestly, not a silent partial claim. Items 3-4 (never encrypted_secrets/
-- financial-posting access; access ends the moment the session ends) are structural consequences
-- of the design below, not separate work.

-- Resolves the calling authenticated user's own platform_admin_users row id, or null if they
-- aren't one. Needed because platform_admin_users has zero client SELECT policies (SECURITY.md --
-- looked up via the service-role client everywhere else, e.g. lib/auth.ts's getAdminSession()) --
-- this is the one legitimate exception: an admin resolving *their own* identity for a narrow,
-- read-only purpose, same category as caller_tenant_ids()/has_org_role() being SECURITY DEFINER
-- to break the same kind of self-lookup deadlock.
create or replace function public.caller_platform_admin_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from public.platform_admin_users where auth_user_id = auth.uid() and is_active = true;
$$;

-- Lets a platform admin read (only) their own support_access_sessions rows -- needed by the
-- app-layer session banner and by has_org_role()'s support-mode branch below being usable from
-- resolvePortalSession() (which runs as the caller's own session-bound client, not service-role).
-- Still nothing here for anyone else: no policy grants visibility into another admin's sessions,
-- and org staff were never able to see this table at all (unchanged).
create policy "support_access_sessions_select_own"
  on public.support_access_sessions for select
  using (platform_admin_id = public.caller_platform_admin_id());

-- has_org_role(): adds one additional, narrowly-scoped OR branch. Audited against every existing
-- call site in this schema before writing this (grep across all migrations) -- with one
-- exception (portfolio_insights_dismiss_org, fixed below in this same migration), every policy
-- that calls has_org_role(..., 'viewer') is a SELECT-only policy, so broadening what 'viewer'
-- means only ever widens *read* access, never write access, everywhere else in the schema.
-- Deliberately does NOT check `o.status <> 'archived'` the way the real-membership branch does --
-- SUPER_ADMIN.md: "archived orgs retain full data for compliance/audit," and a support session
-- investigating exactly that org is the compliance-access case, not an oversight.
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
  )
  or (
    min_role = 'viewer'
    and exists (
      select 1
      from public.support_access_sessions sas
      where sas.org_id = target_org_id
        and sas.ended_at is null
        and sas.platform_admin_id = public.caller_platform_admin_id()
    )
  );
$$;

comment on function public.has_org_role(uuid, public.organization_member_role) is
  'True if the calling authenticated user holds an active membership in target_org_id at or
   above min_role (with organizations.status enforcement per TD-17/migration 20260101000055), OR
   -- viewer floor only, never higher -- holds an active (ended_at is null) support_access_sessions
   row against target_org_id (SUPER_ADMIN.md §6 read-only-by-default support mode,
   PWA_V1_COMPLETION_PLAN.md #12). The support-mode branch ignores organizations.status entirely
   (archived orgs stay admin-readable for compliance).';

-- organizations_select_member (migration 20260101000018) predates has_org_role() (021) and was
-- never migrated onto it -- an inline `id in (select org_id from organization_members ...)` check
-- with no organizations.status awareness at all. Two real consequences, both fixed by switching
-- it to has_org_role(id, 'viewer'):
--   1. TD-17 residual gap: the org-status-enforcement fix (migration 20260101000055) updated
--      has_org_role() so an archived org's own members lose all access -- but this policy,
--      never routed through has_org_role(), still let them see the bare `organizations` row
--      itself. Found while wiring the support-session grant below, not assumed away.
--   2. Without this, the support-session branch added to has_org_role() above would grant a
--      platform admin viewer-level access to every *other* org-scoped table but not to
--      `organizations` itself (e.g. no legal_name for the support-mode banner to show).
-- Suspended/cancelled orgs are unaffected either way: has_org_role()'s real-membership branch
-- already treats 'viewer' as passing for those statuses (TD-17's own design), same as today.
drop policy if exists "organizations_select_member" on public.organizations;

create policy "organizations_select_member"
  on public.organizations for select
  using (public.has_org_role(id, 'viewer'));

-- The one write policy in the whole schema gated at the 'viewer' floor (every other write policy
-- requires 'agent'+, unaffected by the branch above). Rewritten to check real membership
-- directly, matching what has_org_role(org_id, 'viewer') meant *before* this migration -- without
-- this, a support-mode admin could dismiss a target org's portfolio insights, a genuine (if
-- low-stakes) write, violating "read-only by default." Found by auditing every has_org_role(...,
-- 'viewer') call site in this schema before broadening the function, not assumed safe.
drop policy if exists "portfolio_insights_dismiss_org" on public.portfolio_insights;

create policy "portfolio_insights_dismiss_org"
  on public.portfolio_insights for update
  using (
    exists (
      select 1 from public.organization_members om
      where om.org_id = portfolio_insights.org_id and om.user_id = auth.uid() and om.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.organization_members om
      where om.org_id = portfolio_insights.org_id and om.user_id = auth.uid() and om.status = 'active'
    )
  );
