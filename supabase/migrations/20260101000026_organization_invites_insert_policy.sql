-- Fixes a real integration gap found during 2026-07-31 multi-tenant foundation verification:
-- `organization_invites` (created in 20260101000018) has always had exactly one policy --
-- `organization_invites_select_same_org` -- and no INSERT policy at all. RLS-enabled + zero
-- matching policy = deny by default, so no `authenticated` client has ever been able to create an
-- invite. This was invisible until an actual end-to-end check of "does the invitations flow work"
-- (not just "does the schema/accept-RPC look right") -- `apps/admin` only ever had
-- `POST /api/v1/organizations/invites/accept`, never `POST /api/v1/organizations/:orgId/invites`
-- (API_SPEC.md §2), so the gap had no caller to surface it.
--
-- Coarse gate only (manager+ can insert at all) -- PERMISSIONS.md's finer rule ("manager may only
-- invite agent/accountant/viewer, not another manager or principal") depends on comparing the
-- *inviter's* role against the *invited* role, which RLS can express but which is clearer and
-- easier to give a specific error message for at the API layer (PERMISSIONS.md layer 2, same
-- category as its own "only accountant+ can trigger the posting service" example) -- enforced in
-- apps/admin/app/api/v1/organizations/[orgId]/invites/route.ts, not duplicated here.
create policy "organization_invites_insert_manager_plus"
  on public.organization_invites for insert
  with check (public.has_org_role(org_id, 'manager'));
