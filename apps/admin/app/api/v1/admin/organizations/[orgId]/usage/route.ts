import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';

type RouteParams = { params: Promise<{ orgId: string }> };

/** GET /api/v1/admin/organizations/:orgId/usage (API_SPEC.md §2, DATABASE.md §7) -- read_only_admin+. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const guard = await requireAdminRoleOrRespond('read_only_admin');
  if ('response' in guard) return guard.response;

  const { orgId } = await params;
  const serviceClient = getServiceRoleClient();
  const { data, error } = await serviceClient
    .from('usage_snapshots')
    .select('id, org_id, period, usage_type, total_quantity, computed_at')
    .eq('org_id', orgId)
    .order('period', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: { code: 'usage_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    usage: (data ?? []).map((row) => ({
      id: row.id,
      orgId: row.org_id,
      period: row.period,
      usageType: row.usage_type,
      totalQuantity: row.total_quantity,
      computedAt: row.computed_at,
    })),
  });
}
