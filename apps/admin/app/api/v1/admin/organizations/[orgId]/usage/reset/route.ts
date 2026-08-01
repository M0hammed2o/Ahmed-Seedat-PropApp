import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * POST /api/v1/admin/organizations/:orgId/usage/reset (API_SPEC.md §2, SUPER_ADMIN.md §4) --
 * operations_admin+. Zeroes the CURRENT-period `usage_snapshots` rows for the org (never deletes
 * `usage_events` -- those remain the permanent record a reconciliation could always recompute
 * from). "Current period" is taken as the calendar month, matching M18's usage-cap check
 * (checkAiUsageCap()) -- the same simplification, since the scheduled rollup job that would
 * populate/refresh usage_snapshots on a real billing-cycle boundary doesn't exist yet
 * (TECHNICAL_DEBT_REGISTER.md TD-20).
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const guard = await requireAdminRoleOrRespond('operations_admin');
  if ('response' in guard) return guard.response;

  const { orgId } = await params;
  const serviceClient = getServiceRoleClient();

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const periodStart = monthStart.toISOString().slice(0, 10);

  const { data, error } = await serviceClient
    .from('usage_snapshots')
    .update({ total_quantity: 0, computed_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('period', periodStart)
    .select('id, usage_type');

  if (error) {
    return NextResponse.json(
      { error: { code: 'usage_reset_failed', message: error.message } },
      { status: 500 },
    );
  }

  await writeAuditEvent(serviceClient, {
    orgId,
    actorUserId: guard.session.authUserId,
    actorType: 'user',
    action: 'organization.usage_reset',
    entityType: 'usage_snapshots',
    entityId: orgId,
    after: { period: periodStart, reset_count: (data ?? []).length },
  });

  return NextResponse.json({ reset: (data ?? []).map((row) => ({ id: row.id, usageType: row.usage_type })) });
}
