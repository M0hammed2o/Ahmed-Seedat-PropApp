import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient, getAdminServerEnv } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { runSubscriptionLifecycleJob } from '@/lib/systemJobs';

/**
 * POST /api/v1/system/check-subscriptions (Stage 4 commercial-launch execution plan). Real,
 * callable, tested logic -- no dedicated production scheduler is wired to THIS route specifically
 * (WORKLOG.md this date, daily-job consolidation pass: the production Render Cron Job now calls
 * POST /api/v1/system/daily-jobs instead, which runs the exact same runSubscriptionLifecycleJob()
 * this route calls, in sequence with the other two daily jobs). Kept, unchanged in behavior, for
 * manual super-admin runs, independent testing, and any future scheduling need that wants this
 * job in isolation -- see lib/systemJobs.ts, the one place this logic actually lives.
 *
 * Dual-auth: a signed-in super_admin session for on-demand runs, or
 * `Authorization: Bearer <CRON_JOB_SECRET>` for an external scheduler.
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

  const serviceClient = getServiceRoleClient();

  try {
    const result = await runSubscriptionLifecycleJob(serviceClient, actorUserId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'subscription_lifecycle_check_failed',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      },
      { status: 500 },
    );
  }
}
