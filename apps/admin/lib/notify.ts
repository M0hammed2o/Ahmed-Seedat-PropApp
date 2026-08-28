import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// V1 launch-completion pass (WORKLOG.md this date): the first real dispatcher for the
// `notifications` table (migration 20260101000039_notifications.sql). That migration only ever
// shipped row-mapping helpers (lib/notifications.ts) -- confirmed by exhaustive grep, nothing in
// the codebase inserted into `notifications` before this file. The Notification Center UI
// (app/(dashboard)/notifications, components/notifications/NotificationsList.tsx) already reads
// and marks-read the caller's own rows correctly via RLS; it only needed real rows to exist.
//
// `notifications.user_id` is a single recipient, not org/property-scoped (by design -- the
// migration's own comment: "a user can receive notifications tied to any org they belong to").
// So "notify relevant staff about a property/org event" means resolving the recipient set here,
// in TypeScript, and inserting one row per recipient -- mirroring emailDispatch.ts/
// whatsappDispatch.ts's "dispatch to relevant recipients" shape, but structurally simpler (a
// same-database insert via the service-role client, not an external provider call, so there's no
// provider-availability gate, only recipient resolution + fail-soft error handling).
//
// Always insert via a service-role client (bypasses RLS, which has no insert policy on this
// table at all -- by design, matching the migration's "server-side... created" comment). Never
// insert via a caller's own session-bound client here.

type OrgMemberRole = 'viewer' | 'accountant' | 'agent' | 'manager' | 'principal';

// Mirrors has_org_role()'s exact per-min_role allow-list (migration
// 20260101000021_org_role_helpers.sql) -- 'accountant' and 'agent' are siblings, not ranked
// against each other, so minRole: 'agent' does NOT admit 'accountant'-only members and vice
// versa. Kept as a literal table (not a numeric rank) for the same reason has_org_role() is.
const ORG_ROLES_AT_OR_ABOVE: Record<OrgMemberRole, OrgMemberRole[]> = {
  viewer: ['viewer', 'accountant', 'agent', 'manager', 'principal'],
  accountant: ['accountant', 'manager', 'principal'],
  agent: ['agent', 'manager', 'principal'],
  manager: ['manager', 'principal'],
  principal: ['principal'],
};

export interface NotifyPropertyStaffInput {
  orgId: string;
  /** Omit (or null) for an org-wide event with no specific property -- recipients are then just
   * every org-role-qualified active member, with no property_access intersection. */
  propertyId?: string | null;
  type: string;
  title: string;
  body?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  /** Don't notify the actor who caused their own event. */
  excludeUserId?: string | null;
  /** Which org role tier should receive this. Default 'agent' -- matches this pass's producers
   * (maintenance/payment/rent/lease events are all agent+ concerns, never viewer-only staff). */
  minRole?: OrgMemberRole;
}

export interface NotifyUserInput {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
}

/**
 * Notifies every active org member at or above `minRole`, intersected with `property_access` on
 * `propertyId` when one is given (a property-scoped event never reaches staff who lack access to
 * that specific property, even if they otherwise qualify on org role alone). Fail-soft: never
 * throws -- a notification-insert failure must never break the calling flow's primary success
 * path. Errors are logged via console.error only.
 */
export async function notifyPropertyStaff(
  serviceClient: SupabaseClient,
  input: NotifyPropertyStaffInput,
): Promise<void> {
  try {
    const minRole = input.minRole ?? 'agent';
    const allowedRoles = ORG_ROLES_AT_OR_ABOVE[minRole];

    const { data: members, error: membersError } = await serviceClient
      .from('organization_members')
      .select('user_id')
      .eq('org_id', input.orgId)
      .eq('status', 'active')
      .in('role', allowedRoles);
    if (membersError) throw membersError;

    let recipientIds = ((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);

    if (input.propertyId) {
      const { data: access, error: accessError } = await serviceClient
        .from('property_access')
        .select('user_id')
        .eq('property_id', input.propertyId);
      if (accessError) throw accessError;
      const accessibleUserIds = new Set(
        ((access ?? []) as Array<{ user_id: string }>).map((a) => a.user_id),
      );
      recipientIds = recipientIds.filter((id) => accessibleUserIds.has(id));
    }

    if (input.excludeUserId) {
      recipientIds = recipientIds.filter((id) => id !== input.excludeUserId);
    }

    // Dedup defensively -- one notification row per real recipient, never more.
    const uniqueRecipientIds = Array.from(new Set(recipientIds));
    if (uniqueRecipientIds.length === 0) return;

    const rows = uniqueRecipientIds.map((userId) => ({
      user_id: userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      related_entity_type: input.relatedEntityType ?? null,
      related_entity_id: input.relatedEntityId ?? null,
    }));

    const { error: insertError } = await serviceClient.from('notifications').insert(rows);
    if (insertError) throw insertError;
  } catch (err) {
    console.error('[notify] notifyPropertyStaff failed', err);
  }
}

/**
 * Single-recipient case -- e.g. notifying one specific tenant/applicant/owner user directly when
 * their user_id is already known. Same fail-soft contract as notifyPropertyStaff: never throws.
 */
export async function notifyUser(
  serviceClient: SupabaseClient,
  input: NotifyUserInput,
): Promise<void> {
  try {
    const { error } = await serviceClient.from('notifications').insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      related_entity_type: input.relatedEntityType ?? null,
      related_entity_id: input.relatedEntityId ?? null,
    });
    if (error) throw error;
  } catch (err) {
    console.error('[notify] notifyUser failed', err);
  }
}
