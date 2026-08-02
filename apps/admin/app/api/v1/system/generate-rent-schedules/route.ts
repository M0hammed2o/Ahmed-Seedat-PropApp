import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient, getAdminServerEnv } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { writeAuditEvent } from '@/lib/audit';

/**
 * POST /api/v1/system/generate-rent-schedules (TASKS.md M10, TECHNICAL_DEBT_REGISTER.md TD-20).
 *
 * The callable surface for the recurring-rent-schedule generator until a real production
 * scheduler exists (TASKS.md M24 "deployment" owns wiring an actual cron trigger against this
 * endpoint — e.g. a Vercel Cron / hosting-platform scheduled HTTP call once that platform is
 * chosen). Until then this is invoked either manually by a super_admin from Super Admin tooling,
 * or by any external scheduler that has been given CRON_JOB_SECRET out of band.
 *
 * Two independent ways to authenticate, deliberately not merged into one check:
 * - A signed-in platform-admin session (super_admin+) — for manual/on-demand runs.
 * - `Authorization: Bearer <CRON_JOB_SECRET>` — for a scheduler with no user session at all.
 * CRON_JOB_SECRET is optional; if unset in this environment, only the session path works (safe
 * local/dev default — nothing accepts an empty secret as a valid Bearer value).
 */
export async function POST(request: NextRequest) {
  const env = getAdminServerEnv();
  const authHeader = request.headers.get('authorization');
  const bearerSecret = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null;
  const secretAuthorized = !!env.CRON_JOB_SECRET && bearerSecret === env.CRON_JOB_SECRET;

  let actorUserId: string | null = null;
  if (!secretAuthorized) {
    const guard = await requireAdminRoleOrRespond('super_admin');
    if ('response' in guard) return guard.response;
    actorUserId = guard.session.authUserId;
  }

  let horizonMonths = 1;
  try {
    const body = await request.json();
    if (typeof body?.horizonMonths === 'number' && body.horizonMonths >= 1 && body.horizonMonths <= 12) {
      horizonMonths = Math.floor(body.horizonMonths);
    }
  } catch {
    // No/invalid body is fine — default 1-month horizon applies.
  }

  const serviceClient = getServiceRoleClient();

  const throughDate = new Date();
  throughDate.setMonth(throughDate.getMonth() + horizonMonths);
  const throughIso = throughDate.toISOString().slice(0, 10);

  const { data, error } = await serviceClient.rpc('generate_rent_schedules_for_active_leases', {
    p_through: throughIso,
  });

  if (error) {
    return NextResponse.json(
      { error: { code: 'rent_schedule_generation_failed', message: error.message } },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as Array<{ lease_id: string; org_id: string; created_count: number }>;
  const totalCreated = rows.reduce((sum, r) => sum + r.created_count, 0);
  const leasesWithNewRows = rows.filter((r) => r.created_count > 0).length;
  const byOrg = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.org_id] = (acc[r.org_id] ?? 0) + r.created_count;
    return acc;
  }, {});

  await writeAuditEvent(serviceClient, {
    orgId: null,
    actorUserId,
    actorType: actorUserId ? 'user' : 'system',
    action: 'rent_schedules.generate',
    entityType: 'rent_schedules',
    entityId: 'bulk',
    after: { through: throughIso, leases_processed: rows.length, leases_with_new_rows: leasesWithNewRows, total_created: totalCreated },
  });

  return NextResponse.json({
    through: throughIso,
    leasesProcessed: rows.length,
    leasesWithNewRows,
    totalCreated,
    createdByOrg: byOrg,
  });
}
