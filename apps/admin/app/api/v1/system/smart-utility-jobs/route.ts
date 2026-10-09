import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient, getAdminServerEnv } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { jobFailed, runSmartUtilityJob } from '@/lib/smartUtility/jobs';

/**
 * POST /api/v1/system/smart-utility-jobs -- runs only the Smart Utility job (health sweep, anomaly
 * rules, reconciliation, due submission packs, deliveries + retries, status sync). The same job also
 * runs inside /api/v1/system/daily-jobs; this route exists so it can be scheduled more often later
 * (e.g. hourly retries) without re-running the whole daily batch. Same dual auth as every
 * system-job route: `Authorization: Bearer <CRON_JOB_SECRET>` or a signed-in super_admin.
 */
export async function POST(request: NextRequest) {
  const env = getAdminServerEnv();
  const authHeader = request.headers.get('authorization');
  const bearer = authHeader?.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
  const secretAuthorized = !!env.CRON_JOB_SECRET && bearer === env.CRON_JOB_SECRET;
  if (!secretAuthorized) {
    const guard = await requireAdminRoleOrRespond('super_admin');
    if ('response' in guard) return guard.response;
  }
  const result = await runSmartUtilityJob(getServiceRoleClient());
  return NextResponse.json({ result }, { status: jobFailed(result) ? 500 : 200 });
}
