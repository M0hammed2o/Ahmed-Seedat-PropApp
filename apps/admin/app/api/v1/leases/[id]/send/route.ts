import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { mapLeasePreparationRow } from '@/lib/leasing';
import { dispatchLeaseReadyEmail, dispatchLeaseReadyWhatsApp } from '@/lib/leaseNotifications';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/leases/:id/send (Phase S/T, migration 20260101000134). Explicit send -- generating
 * or approving never sends on their own. send_lease() itself refuses a not-yet-reviewed lease or a
 * lease whose source application isn't approved. Idempotent on the RPC side (a resend with no new
 * draft document is a no-op); the email dispatch below has its own independent idempotency via the
 * existing email_messages pre-send check (lib/emailDispatch.ts), so a resend never double-sends
 * either the state transition or the notification.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  // Captured before the RPC call so the audit action can distinguish a true first send from an
  // idempotent resend (send_lease() itself is a no-op on the state transition when already sent).
  const { data: priorPrep } = await supabase
    .from('lease_preparations')
    .select('status')
    .eq('lease_id', id)
    .maybeSingle();
  const wasAlreadySent = priorPrep?.status === 'sent';

  const { data, error } = await supabase.rpc('send_lease', { p_lease_id: id }).single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'lease_send_failed', message: error.message } },
      { status: 400 },
    );
  }

  const emailResult = await dispatchLeaseReadyEmail(supabase, id);
  const whatsappResult = await dispatchLeaseReadyWhatsApp(id);
  const prep = mapLeasePreparationRow(data as Parameters<typeof mapLeasePreparationRow>[0]);

  await writeAuditEvent(getServiceRoleClient(), {
    orgId: prep.orgId,
    actorUserId: user.id,
    actorType: 'user',
    action: wasAlreadySent ? 'lease.resent' : 'lease.sent',
    entityType: 'leases',
    entityId: id,
    after: { sentAt: prep.sentAt, emailSent: emailResult.sent },
  });

  return NextResponse.json({ leasePreparation: prep, email: emailResult, whatsapp: whatsappResult });
}
