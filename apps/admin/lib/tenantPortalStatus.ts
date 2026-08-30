// Tenant/occupancy V1 pass: a tenant-level rollup of "does this tenant have Proplyst portal
// access" -- distinct from TenantInvitationPanel.tsx's own per-invitation statusFor() (which
// answers "what happened to this one invitation row" and needs a client-side hydration guard
// because it re-renders reactively after send()/revoke()). This function is pure and has no
// hydration concern of its own: every call site in this pass computes it ONCE, server-side, in a
// Server Component, and passes the already-resolved {status, label} down as plain data -- never
// re-evaluated against a live `new Date()` on the client. No new database state: derived entirely
// from tenants.user_id (already nullable, DATABASE.md) and the existing tenant_invitations table.
//
// Deliberately isomorphic (no 'server-only' import, unlike lib/tenantInvitations.ts) so both
// Server Components (tenants list/detail pages) and Client Components (TenantsTable) can import
// the same derivation without duplicating the rules.

export type TenantPortalStatus = 'active' | 'not_invited' | 'pending' | 'expired';

export interface TenantPortalStatusResult {
  status: TenantPortalStatus;
  label: string;
}

export interface InvitationForPortalStatus {
  acceptedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

const PORTAL_STATUS_LABEL: Record<TenantPortalStatus, string> = {
  active: 'Active',
  not_invited: 'Not invited',
  pending: 'Invitation pending',
  expired: 'Invitation expired',
};

// Shared display tone -- reuses the same color intent as the closest matching existing status
// tones (paid/accent/overdue/muted) rather than introducing a new palette. One definition, used by
// both the tenant list table and the tenant detail page, so the two can never visually drift.
export const PORTAL_STATUS_TONE: Record<TenantPortalStatus, string> = {
  active: 'text-light-statusPaid dark:text-dark-statusPaid',
  pending: 'text-light-accent dark:text-dark-accent',
  expired: 'text-light-statusOverdue dark:text-dark-statusOverdue',
  not_invited: 'text-light-textMuted dark:text-dark-textMuted',
};

export function deriveTenantPortalStatus(
  userId: string | null,
  invitations: InvitationForPortalStatus[],
): TenantPortalStatusResult {
  if (userId) return { status: 'active', label: PORTAL_STATUS_LABEL.active };

  const latest = [...invitations].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
  // No invitation ever sent, or the most recent one was revoked (functionally the same
  // actionable state as never-invited: staff can send a fresh one either way).
  if (!latest || latest.revokedAt) {
    return { status: 'not_invited', label: PORTAL_STATUS_LABEL.not_invited };
  }
  if (new Date(latest.expiresAt) <= new Date()) {
    return { status: 'expired', label: PORTAL_STATUS_LABEL.expired };
  }
  return { status: 'pending', label: PORTAL_STATUS_LABEL.pending };
}
