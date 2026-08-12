import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient, getAdminServerEnv } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { dispatchEmail } from '@/lib/emailDispatch';

/**
 * POST /api/v1/system/check-compliance-requirements (property compliance workflow, notification
 * lifecycle completion, WORKLOG.md this date). Mirrors POST /api/v1/system/check-subscriptions
 * exactly -- same dual-auth (a signed-in super_admin session for on-demand runs, or
 * `Authorization: Bearer <CRON_JOB_SECRET>` for an external scheduler), same disclosed posture:
 * this is real, callable, tested logic with NO production scheduler wired to it yet (blocked on
 * the same Stage 8 hosting decision as check-subscriptions/generate-rent-schedules, TASKS.md) --
 * the event/data support is built and exercised on demand, rather than inventing an unreliable
 * client-side or best-effort mechanism to approximate a real cron.
 *
 * Two independent sweeps per run, each stamping its own idempotency marker so re-running the same
 * window never double-sends:
 * 1. compliance_requirements_due_soon(3) -- requirements due within 3 days, not yet reminded.
 * 2. compliance_requirements_overdue_unreminded() -- requirements already past due, not yet
 *    reminded.
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

  const [dueSoonResult, overdueResult] = await Promise.all([
    serviceClient.rpc('compliance_requirements_due_soon', { p_within_days: 3 }),
    serviceClient.rpc('compliance_requirements_overdue_unreminded'),
  ]);
  if (dueSoonResult.error) {
    return NextResponse.json(
      {
        error: {
          code: 'compliance_reminder_check_failed',
          message: dueSoonResult.error.message,
        },
      },
      { status: 500 },
    );
  }
  if (overdueResult.error) {
    return NextResponse.json(
      {
        error: {
          code: 'compliance_reminder_check_failed',
          message: overdueResult.error.message,
        },
      },
      { status: 500 },
    );
  }

  const dueSoonSent = await sendReminders(
    serviceClient,
    dueSoonResult.data ?? [],
    'compliance_requirement_due_soon',
    'due_reminder_sent_at',
  );
  const overdueSent = await sendReminders(
    serviceClient,
    overdueResult.data ?? [],
    'compliance_requirement_overdue',
    'overdue_reminder_sent_at',
  );

  return NextResponse.json({
    dueSoonRemindersSent: dueSoonSent,
    overdueRemindersSent: overdueSent,
  });
}

interface ComplianceRequirementRow {
  id: string;
  org_id: string;
  tenant_id: string;
  due_at: string | null;
  rule_version_id: string;
}

async function sendReminders(
  serviceClient: ReturnType<typeof getServiceRoleClient>,
  rows: ComplianceRequirementRow[],
  templateName: 'compliance_requirement_due_soon' | 'compliance_requirement_overdue',
  markerColumn: 'due_reminder_sent_at' | 'overdue_reminder_sent_at',
): Promise<number> {
  let sent = 0;
  for (const row of rows) {
    try {
      const [{ data: tenant }, { data: ruleVersion }] = await Promise.all([
        serviceClient
          .from('tenants')
          .select('email, full_name')
          .eq('id', row.tenant_id)
          .maybeSingle(),
        serviceClient
          .from('property_rule_versions')
          .select(
            'version_number, property_rules(title), properties:property_rules(properties(nickname))',
          )
          .eq('id', row.rule_version_id)
          .maybeSingle(),
      ]);

      if (tenant?.email) {
        const ruleTitle =
          (ruleVersion?.property_rules as unknown as { title: string } | null)?.title ?? 'a rule';
        const { data: requirementProperty } = await serviceClient
          .from('compliance_requirements')
          .select('properties(nickname)')
          .eq('id', row.id)
          .maybeSingle();
        const propertyLabel =
          (requirementProperty?.properties as unknown as { nickname: string } | null)?.nickname ??
          'your rental';

        await dispatchEmail(serviceClient, {
          orgId: row.org_id,
          toAddress: tenant.email,
          toUserId: null,
          templateName,
          templateVars: {
            ruleTitle,
            propertyLabel,
            dueAt: row.due_at ? new Date(row.due_at).toLocaleDateString('en-ZA') : null,
          },
          relatedEntityType: `compliance_requirements:${markerColumn}`,
          relatedEntityId: row.id,
          actorUserId: null,
        });
      }

      // Stamped even when the tenant has no email on file -- a requirement with nobody to email
      // still shouldn't be re-attempted on every future run (same posture check-subscriptions'
      // own trial-reminder loop already takes).
      await serviceClient
        .from('compliance_requirements')
        .update({ [markerColumn]: new Date().toISOString() })
        .eq('id', row.id);
      sent += 1;
    } catch (err) {
      console.error(`[emailDispatch] ${templateName} dispatch failed`, err);
    }
  }
  return sent;
}
