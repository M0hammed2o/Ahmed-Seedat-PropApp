import 'server-only';

/**
 * Staff security + audit hardening follow-up (this date). Narrow, exact-match set of the
 * principal-only authorization-denial messages raised by migration 20260101000125's staff RPCs
 * (`provision_staff_member`, `update_organization_member_role`, `revoke_organization_member`,
 * `set_member_property_access_mode`, `grant_property_access`, `revoke_property_access`,
 * `revoke_organization_invite`). The thin route wrappers around these RPCs previously surfaced
 * EVERY RPC failure as a generic 400 -- real Manager testing in production correctly proved the
 * ACTION was blocked (the RPC's own principal-only check fired), but the wrong HTTP status came
 * back. `isPrincipalOnlyDenial()` maps ONLY these exact, known strings to 403; every other RPC
 * failure (seat limits, "not found", the Principal self-protection guards, validation) is
 * deliberately left alone -- those are business-rule outcomes, not an authorization/role-
 * insufficiency signal, and converting them to 403 was explicitly out of scope for this fix.
 */
const PRINCIPAL_ONLY_DENIAL_MESSAGES = new Set([
  'Only the organization principal may provision staff',
  "Only the organization principal may change another member's role",
  'Only the organization principal may remove a staff member',
  "Only the organization principal may change a member's property access mode",
  'Only the organization principal may grant property access',
  'Only the organization principal may revoke property access',
  'Only the organization principal may revoke an organization invite',
]);

export function isPrincipalOnlyDenial(message: string | null | undefined): boolean {
  return message != null && PRINCIPAL_ONLY_DENIAL_MESSAGES.has(message);
}
