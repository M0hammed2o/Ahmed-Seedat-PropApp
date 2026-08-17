import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentReport } from '@propvault/types';
import { dispatchWhatsApp, resolveOrgWhatsAppBranding } from './whatsappDispatch';

interface PaymentReportRow {
  id: string;
  org_id: string;
  property_id: string;
  lease_id: string;
  rent_schedule_id: string | null;
  tenant_id: string;
  reported_by_tenant: boolean;
  reported_by_user_id: string;
  amount: number | string;
  payment_method: string;
  payment_date: string;
  document_id: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** Final pre-production pass, Phase 1/2: the one row mapper every payment-report UI/route uses. */
export function mapPaymentReportRow(row: PaymentReportRow): PaymentReport {
  return {
    id: row.id,
    orgId: row.org_id,
    propertyId: row.property_id,
    leaseId: row.lease_id,
    rentScheduleId: row.rent_schedule_id,
    tenantId: row.tenant_id,
    reportedByTenant: row.reported_by_tenant,
    reportedByUserId: row.reported_by_user_id,
    amount: Number(row.amount),
    paymentMethod: row.payment_method as PaymentReport['paymentMethod'],
    paymentDate: row.payment_date,
    documentId: row.document_id,
    status: row.status as PaymentReport['status'],
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * WhatsApp V1 completion pass, Phase B (WORKLOG.md this date). Resolves who should be notified to
 * review a newly-reported payment for a property -- every LINKED owner (owners.user_id set, via
 * self-linking or invitation acceptance -- migration 20260101000088/20260101000083) with a phone
 * number on file, via property_owners. Deliberately excludes unlinked owner records (no real
 * account to notify) and owners with no phone (nothing to send a WhatsApp message to) rather than
 * silently guessing a fallback recipient. Multiple owners on the same property each get resolved
 * independently -- the caller (notifyOwnersOfPaymentReport below) dispatches to each one
 * separately, with a per-owner idempotency key, so two owners never collide on the same
 * whatsapp_messages row and neither is skipped because the other already "used" the slot.
 */
export interface EligiblePaymentReportRecipient {
  ownerId: string;
  userId: string;
  phone: string;
}

export async function resolveEligibleOwnerRecipients(
  serviceClient: SupabaseClient,
  propertyId: string,
): Promise<EligiblePaymentReportRecipient[]> {
  const { data } = await serviceClient
    .from('property_owners')
    .select('owner_id, owners(id, user_id, phone)')
    .eq('property_id', propertyId);

  const rows = (data ?? []) as unknown as {
    owner_id: string;
    owners: { id: string; user_id: string | null; phone: string | null } | null;
  }[];

  return rows
    .filter((r) => r.owners?.user_id && r.owners.phone)
    .map((r) => ({ ownerId: r.owners!.id, userId: r.owners!.user_id!, phone: r.owners!.phone! }));
}

/**
 * Dispatches `payment_confirmation_required` to every eligible owner independently (never "the
 * org" as a whole -- WhatsApp V1 completion Phase B's explicit "do NOT simply notify every user in
 * an organisation" instruction). Best-effort per recipient: one owner's dispatch failure (or
 * preference opt-out) never blocks another's. Returns while the template is unapproved
 * (dispatchWhatsApp's own Phase K gate) -- this call site doesn't need to know or care about
 * approval status, it just always attempts the dispatch and lets the shared gate decide.
 */
export async function notifyOwnersOfPaymentReport(
  serviceClient: SupabaseClient,
  input: { orgId: string; propertyId: string; paymentReportId: string; amount: number },
): Promise<void> {
  const recipients = await resolveEligibleOwnerRecipients(serviceClient, input.propertyId);
  if (recipients.length === 0) return;

  const branding = await resolveOrgWhatsAppBranding(serviceClient, input.orgId);

  for (const recipient of recipients) {
    try {
      await dispatchWhatsApp(serviceClient, {
        orgId: input.orgId,
        toPhone: recipient.phone,
        toUserId: recipient.userId,
        templateName: 'payment_confirmation_required',
        variables: { organizationName: branding.organizationName, amount: String(input.amount) },
        // Per-recipient idempotency key -- a property with 2 owners must notify BOTH, never let
        // the second owner's dispatch be silently swallowed by dispatchWhatsApp's own
        // (relatedEntityType, relatedEntityId, templateName) idempotency guard matching the first.
        relatedEntityType: `payment_report:${recipient.ownerId}`,
        relatedEntityId: input.paymentReportId,
        actorUserId: null,
      });
    } catch (err) {
      console.error('[notificationDispatch] payment_confirmation_required dispatch failed', err);
    }
  }
}
