import 'server-only';
import type { TenantInvitation } from '@propvault/types';

// Row-mapping for apps/admin/app/api/v1/tenants/[id]/invitations/** (PRODUCT DECISION 2,
// 2026-08-03). Deliberately never maps token_hash/short_code_hash -- those never leave the
// database except as the one-time plaintext create_tenant_invitation() itself returns.

interface TenantInvitationRow {
  id: string;
  org_id: string;
  tenant_id: string;
  delivery_channel: string;
  destination_hint: string | null;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_user_id: string | null;
  revoked_at: string | null;
  created_by_user_id: string;
  failed_attempt_count: number;
  resend_count: number;
  created_at: string;
}

export function mapTenantInvitationRow(row: TenantInvitationRow): TenantInvitation {
  return {
    id: row.id,
    orgId: row.org_id,
    tenantId: row.tenant_id,
    deliveryChannel: row.delivery_channel as TenantInvitation['deliveryChannel'],
    destinationHint: row.destination_hint,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    acceptedByUserId: row.accepted_by_user_id,
    revokedAt: row.revoked_at,
    createdByUserId: row.created_by_user_id,
    failedAttemptCount: row.failed_attempt_count,
    resendCount: row.resend_count,
    createdAt: row.created_at,
  };
}

/** Masks an email or phone for staff-facing display -- never the raw destination
 *  (PRODUCT DECISION 2: "see masked destination"). */
export function maskDestination(value: string): string {
  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    const visible = local!.slice(0, 1);
    return `${visible}${'*'.repeat(Math.max(local!.length - 1, 1))}@${domain}`;
  }
  // Phone-like: keep the last 2 digits, mask the rest.
  const digits = value.replace(/\s/g, '');
  return `${digits.slice(0, digits.length > 4 ? 3 : 0)}${'*'.repeat(Math.max(digits.length - 5, 3))}${digits.slice(-2)}`;
}
