-- Property owners relationship-management pass (V1 launch-completion, this date): UI/API support
-- for (a) a self-owner "Yes, I own this property" flow, (b) inline ownership-percentage editing,
-- and (c) removing a property<->owner RELATIONSHIP (not the owner identity).
--
-- (c) is the only piece with a DB-level question: does a DELETE RLS policy already exist on
-- property_owners? Verified by grep across every migration referencing property_owners before
-- writing any application code:
--   - 20260101000022 created "property_owners_write_agent_plus" `for all` (agent+ org role).
--   - 20260101000084 dropped that policy and replaced it with
--     "property_owners_write_agent_plus_and_property_access" `for all`, requiring agent+ org role
--     AND (has_property_access(..., 'owner') OR has_property_access(..., 'administrator')).
--   - No later migration touches either policy name again.
-- A Postgres `for all` policy applies to every command including DELETE (DELETE evaluates only the
-- USING clause; WITH CHECK is a no-op for DELETE since there is no new row). So DELETE on
-- property_owners is already gated exactly the way every other property_owners write is gated --
-- adding a second, separate DELETE policy here would be a pure duplicate enforcing the identical
-- condition, which the task brief explicitly says to avoid. No new policy is added.
--
-- This migration documents that verification in the database itself (comment only, no behavioural
-- change) so a future reader doesn't have to re-derive it from migration history.
comment on policy "property_owners_write_agent_plus_and_property_access" on public.property_owners is
  'Covers SELECT is handled by property_owners_select_org_member; this `for all` policy is the
   write policy for INSERT, UPDATE, and DELETE alike (org agent+ role AND owner/administrator
   property_access). The property-owners relationship-management DELETE route
   (apps/admin/app/api/v1/properties/[id]/owners/[ownerId]/route.ts) relies on this policy for
   its actual enforcement; verified 2026-08-27 that no separate DELETE policy exists or is needed.';
