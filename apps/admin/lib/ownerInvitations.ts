import 'server-only';
import type { OwnerInvitation } from '@propvault/types';

// Row-mapping for apps/admin/app/api/v1/owners/[id]/invitations/** and
// owner-invitations/accept -- mirrors lib/tenantInvitations.ts exactly. Deliberately never maps
// token_hash -- it never leaves the database except as the one-time plaintext
// create_owner_invitation() itself returns.

interface OwnerInvitationRow {
  id: string;
  org_id: string;
  owner_id: string;
  delivery_channel: string;
  destination_hint: string | null;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_user_id: string | null;
  revoked_at: string | null;
  created_by_user_id: string;
  resend_count: number;
  created_at: string;
}

export function mapOwnerInvitationRow(row: OwnerInvitationRow): OwnerInvitation {
  return {
    id: row.id,
    orgId: row.org_id,
    ownerId: row.owner_id,
    deliveryChannel: row.delivery_channel as OwnerInvitation['deliveryChannel'],
    destinationHint: row.destination_hint,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    acceptedByUserId: row.accepted_by_user_id,
    revokedAt: row.revoked_at,
    createdByUserId: row.created_by_user_id,
    resendCount: row.resend_count,
    createdAt: row.created_at,
  };
}

export { maskDestination } from './tenantInvitations';
