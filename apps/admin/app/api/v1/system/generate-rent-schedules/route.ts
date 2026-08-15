import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient, getAdminServerEnv } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { runRentScheduleJob } from '@/lib/systemJobs';

/**
 * POST /api/v1/system/generate-rent-schedules (TASKS.md M10, TECHNICAL_DEBT_REGISTER.md TD-20).
 * Real, callable, tested logic -- no dedicated production scheduler is wired to THIS route
 * specifically (WORKLOG.md this date, daily-job consolidation pass: the production Render Cron
 * Job now calls POST /api/v1/system/daily-jobs instead, which runs the exact same
 * runRentScheduleJob() this route calls). Kept, unchanged in behavior, for manual super-admin
 * runs, independent testing, and any future scheduling need that wants this job in isolation --
 * see lib/systemJobs.ts, the one place this logic actually lives.
 *
 * Two independent ways to authenticate:
 * - A signed-in platform-admin session (super_admin+) -- for manual/on-demand runs.
 * - `Authorization: Bearer <CRON_JOB_SECRET>` -- for a scheduler with no user session at all.
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
    if (
      typeof body?.horizonMonths === 'number' &&
      body.horizonMonths >= 1 &&
      body.horizonMonths <= 12
    ) {
      horizonMonths = Math.floor(body.horizonMonths);
    }
  } catch {
    // No/invalid body is fine -- default 1-month horizon applies.
  }

  const serviceClient = getServiceRoleClient();

  try {
    const result = await runRentScheduleJob(serviceClient, actorUserId, horizonMonths);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'rent_schedule_generation_failed',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      },
      { status: 500 },
    );
  }
}
