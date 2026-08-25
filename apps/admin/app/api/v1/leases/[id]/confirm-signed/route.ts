import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { mapLeasePreparationRow } from '@/lib/leasing';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/leases/:id/confirm-signed (Phase W). The second of the two V1 lease-acceptance
 * paths -- staff recording that a signed copy came back through another channel (email, in
 * person) and was uploaded manually. Explicitly NOT a certified e-signature; the response/UI must
 * never describe it as one. A plain RLS-guarded update (not a dedicated RPC) since this is a
 * simple staff-only, single-table, in-org action -- protected by the same agent+/property-scoped
 * write policy as lease_preparations' other columns.
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

  const { data, error } = await supabase
    .from('lease_preparations')
    .update({ staff_confirmed_signed_at: new Date().toISOString(), staff_confirmed_signed_by: user.id })
    .eq('lease_id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: { code: 'confirm_signed_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      {
        error: {
          code: 'not_found',
          message: 'No lease preparation record found -- generate or upload a lease document first.',
        },
      },
      { status: 404 },
    );
  }

  await writeAuditEvent(getServiceRoleClient(), {
    orgId: data.org_id,
    actorUserId: user.id,
    actorType: 'user',
    action: 'lease.signed_copy_confirmed',
    entityType: 'leases',
    entityId: id,
    after: { staffConfirmedSignedAt: data.staff_confirmed_signed_at },
  });

  return NextResponse.json({ leasePreparation: mapLeasePreparationRow(data) });
}
