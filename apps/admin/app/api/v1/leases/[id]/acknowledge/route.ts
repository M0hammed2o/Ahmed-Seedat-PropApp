import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { mapLeasePreparationRow } from '@/lib/leasing';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/leases/:id/acknowledge (Phase V/W). Tenant-portal-only: the tenant's own
 * acknowledgement that they've received and reviewed the lease. Explicitly NOT a certified
 * e-signature -- described as "acknowledgement" everywhere, never "signature". Protected entirely
 * by RLS (lease_preparations_tenant_acknowledge, migration 20260101000134): only the caller's own
 * lease, only tenant_acknowledged_at, only once (a second attempt is a harmless no-op -- the RLS
 * USING clause itself excludes an already-acknowledged row).
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

  const { error } = await supabase
    .from('lease_preparations')
    .update({ tenant_acknowledged_at: new Date().toISOString() })
    .eq('lease_id', id);

  if (error) {
    return NextResponse.json(
      { error: { code: 'acknowledge_failed', message: error.message } },
      { status: 500 },
    );
  }

  const { data, error: fetchError } = await supabase
    .from('lease_preparations')
    .select('*')
    .eq('lease_id', id)
    .maybeSingle();
  if (fetchError || !data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Lease not found.' } },
      { status: 404 },
    );
  }

  await writeAuditEvent(getServiceRoleClient(), {
    orgId: data.org_id,
    actorUserId: user.id,
    actorType: 'user',
    action: 'lease.tenant_acknowledged',
    entityType: 'leases',
    entityId: id,
    after: { tenantAcknowledgedAt: data.tenant_acknowledged_at },
  });

  return NextResponse.json({ leasePreparation: mapLeasePreparationRow(data) });
}
