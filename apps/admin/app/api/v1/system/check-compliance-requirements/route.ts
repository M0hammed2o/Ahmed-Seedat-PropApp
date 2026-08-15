import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient, getAdminServerEnv } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { runComplianceReminderJob } from '@/lib/systemJobs';

/**
 * POST /api/v1/system/check-compliance-requirements (property compliance workflow, notification
 * lifecycle completion). Real, callable, tested logic -- this is the route the live
 * `proplyst-compliance-reminders` Render Cron Job currently calls (verified in production,
 * WORKLOG.md). Daily-job consolidation pass (WORKLOG.md this date): the production cron job will
 * be manually repurposed to call POST /api/v1/system/daily-jobs instead, which runs the exact same
 * runComplianceReminderJob() this route calls, alongside the subscription-lifecycle and
 * rent-schedule jobs. This route is kept, unchanged in behavior, for manual super-admin runs,
 * independent testing, and any future scheduling need that wants this job in isolation -- see
 * lib/systemJobs.ts, the one place this logic actually lives.
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

  if (!secretAuthorized) {
    const guard = await requireAdminRoleOrRespond('super_admin');
    if ('response' in guard) return guard.response;
  }

  const serviceClient = getServiceRoleClient();

  try {
    const result = await runComplianceReminderJob(serviceClient);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'compliance_reminder_check_failed',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      },
      { status: 500 },
    );
  }
}
