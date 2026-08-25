import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { mapLeasePreparationRow } from '@/lib/leasing';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/leases/:id/review (Phase R, migration 20260101000134). The server-enforced
 * "I confirm the lease details are correct and ready to send" acknowledgement -- calls
 * acknowledge_lease_review(), which independently re-validates every precondition (tenant
 * assigned, rent > 0, start date set, a draft lease document exists) rather than trusting the
 * client sent this request in good faith.
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

  const { data, error } = await supabase.rpc('acknowledge_lease_review', { p_lease_id: id }).single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'lease_review_failed', message: error.message } },
      { status: 400 },
    );
  }

  const prep = mapLeasePreparationRow(data as Parameters<typeof mapLeasePreparationRow>[0]);
  await writeAuditEvent(getServiceRoleClient(), {
    orgId: prep.orgId,
    actorUserId: user.id,
    actorType: 'user',
    action: 'lease.reviewed',
    entityType: 'leases',
    entityId: id,
    after: { reviewedAt: prep.reviewedAt },
  });

  return NextResponse.json({ leasePreparation: prep });
}
