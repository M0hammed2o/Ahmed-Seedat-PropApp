-- Overnight platform pass (WORKLOG.md this date): real bug found while diagnosing "staff
-- invitation emails never arrive" -- POST /api/v1/organization-invites/:id/resend dispatches
-- through the SAME relatedEntityId (organization_invites.id) the original creation call already
-- used, and dispatchEmail() is idempotent on (related_entity_type, related_entity_id,
-- template_name) by design (one email per event, never a duplicate send on a retried request).
-- That's exactly right for "don't double-send," but it also means every "Resend" click was
-- silently swallowed by the SAME idempotency guard -- confirmed by reading dispatchEmail(), not
-- assumed. owner_invitations (20260101000083) and tenant_invitations (20260101000059) both
-- already carry resend_count for precisely this reason (each resend gets its own suffixed
-- relatedEntityId); organization_invites never got the same column when it was extended
-- (20260101000089) to carry property_access_mode. Additive, matches the existing pattern exactly.
alter table public.organization_invites
  add column resend_count integer not null default 0;

comment on column public.organization_invites.resend_count is
  'Incremented by POST /api/v1/organization-invites/:id/resend, whose dispatchEmail() call keys
   off {id}:resend:{resend_count} rather than the bare invite id, so each resend gets a distinct
   idempotency key instead of being silently absorbed by the original invite email''s.';
