import { NextResponse, type NextRequest } from 'next/server';
import { USAGE_TYPES } from '@propvault/types';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * GET /api/v1/admin/organizations/:orgId/usage (API_SPEC.md §2, DATABASE.md §7) --
 * read_only_admin+. `usage` (historical `usage_snapshots` rows) is unchanged from the original
 * implementation, but is empty for every org today -- the scheduled rollup job that would
 * populate snapshots doesn't exist yet (TECHNICAL_DEBT_REGISTER.md TD-20), same gap lib/ai.ts's
 * checkAiUsageCap() already works around. `currentPeriod` closes that: real-time totals for the
 * current calendar month, summed directly from `usage_events` (same approach, same reasoning) --
 * this is what PWA_V1_COMPLETION_PLAN.md #13's usage-metering UI actually reads, since it needs
 * to show something before that cron exists. Switch the UI to `usage` once the rollup job ships.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const guard = await requireAdminRoleOrRespond('read_only_admin');
  if ('response' in guard) return guard.response;

  const { orgId } = await params;
  const serviceClient = getServiceRoleClient();

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const periodStart = monthStart.toISOString().slice(0, 10);

  const [snapshotsResult, eventsResult] = await Promise.all([
    serviceClient
      .from('usage_snapshots')
      .select('id, org_id, period, usage_type, total_quantity, computed_at')
      .eq('org_id', orgId)
      .order('period', { ascending: false }),
    serviceClient
      .from('usage_events')
      .select('usage_type, quantity')
      .eq('org_id', orgId)
      .gte('recorded_at', monthStart.toISOString()),
  ]);

  if (snapshotsResult.error) {
    return NextResponse.json(
      { error: { code: 'usage_fetch_failed', message: snapshotsResult.error.message } },
      { status: 500 },
    );
  }
  if (eventsResult.error) {
    return NextResponse.json(
      { error: { code: 'usage_events_fetch_failed', message: eventsResult.error.message } },
      { status: 500 },
    );
  }

  const currentPeriod = Object.fromEntries(USAGE_TYPES.map((t) => [t, 0])) as Record<string, number>;
  for (const row of eventsResult.data ?? []) {
    const key = row.usage_type as string;
    currentPeriod[key] = (currentPeriod[key] ?? 0) + (row.quantity as number);
  }

  return NextResponse.json({
    usage: (snapshotsResult.data ?? []).map((row) => ({
      id: row.id,
      orgId: row.org_id,
      period: row.period,
      usageType: row.usage_type,
      totalQuantity: row.total_quantity,
      computedAt: row.computed_at,
    })),
    currentPeriod: { periodStart, totals: currentPeriod },
  });
}
