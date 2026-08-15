import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient, getAdminServerEnv } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { writeAuditEvent } from '@/lib/audit';
import { dispatchEmail } from '@/lib/emailDispatch';

/**
 * POST /api/v1/system/check-subscriptions (Stage 4 commercial-launch execution plan, mirrors
 * POST /api/v1/system/generate-rent-schedules exactly -- same "real function, no production
 * scheduler wired to it yet" posture, same dual-auth: a signed-in super_admin session for
 * on-demand runs, or `Authorization: Bearer <CRON_JOB_SECRET>` for an external scheduler once a
 * hosting target is chosen (TASKS.md M24).
 *
 * Does three independent things per run:
 * 1. Calls expire_trials_and_suspend_overdue() (20260101000076) -- transitions trials past
 *    trial_ends_at, and orgs overdue for more than 7 days, to 'suspended'. Audit-logs and emails
 *    the org's principal for every org actually transitioned.
 * 2. Calls trials_expiring_soon() and sends a reminder email to any trial org expiring within 3
 *    days that hasn't already been reminded, then stamps trial_reminder_sent_at so it is never
 *    reminded twice.
 * 3. RELEASE A: calls apply_due_scheduled_plan_changes() (migration 20260101000104) -- applies
 *    every SCHEDULED downgrade whose effective_at (the renewal date captured when it was
 *    confirmed) has arrived. Reuses this same "subscription lifecycle" sweep rather than a second
 *    scheduled route -- idempotent by construction (a row leaves status='scheduled' the moment
 *    it's applied, so re-running this is always safe, same posture as steps 1-2 above).
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

  const { data: transitions, error: transitionsError } = await serviceClient.rpc(
    'expire_trials_and_suspend_overdue',
  );
  if (transitionsError) {
    return NextResponse.json(
      { error: { code: 'subscription_lifecycle_check_failed', message: transitionsError.message } },
      { status: 500 },
    );
  }

  const rows = (transitions ?? []) as Array<{
    org_id: string;
    previous_status: string;
    new_status: string;
    reason: string;
  }>;

  for (const row of rows) {
    await writeAuditEvent(serviceClient, {
      orgId: row.org_id,
      actorUserId,
      actorType: actorUserId ? 'user' : 'system',
      action: 'organization.status_transition',
      entityType: 'organizations',
      entityId: row.org_id,
      before: { status: row.previous_status },
      after: { status: row.new_status, reason: row.reason },
    });

    // Notify the org's principal -- access has just been locked, they need to know why and how
    // to restore it. Never blocks/fails the run -- same "log, don't throw" boundary as every other
    // dispatchEmail() call site (e.g. the payment_failed handler in lib/billing.ts).
    try {
      const { data: principal } = await serviceClient
        .from('organization_members')
        .select('user_id')
        .eq('org_id', row.org_id)
        .eq('role', 'principal')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (principal) {
        const { data: authUser } = await serviceClient.auth.admin.getUserById(principal.user_id);
        await dispatchEmail(serviceClient, {
          orgId: row.org_id,
          toAddress: authUser?.user?.email ?? null,
          templateName: 'subscription_suspended',
          templateVars: { reason: row.reason },
          relatedEntityType: 'organizations',
          relatedEntityId: row.org_id,
          actorUserId: null,
        });
      }
    } catch (err) {
      console.error('[emailDispatch] subscription_suspended dispatch failed', err);
    }
  }

  const { data: expiringSoon, error: expiringSoonError } = await serviceClient.rpc(
    'trials_expiring_soon',
    { p_within_days: 3 },
  );
  if (expiringSoonError) {
    return NextResponse.json(
      {
        error: { code: 'subscription_lifecycle_check_failed', message: expiringSoonError.message },
      },
      { status: 500 },
    );
  }

  const expiring = (expiringSoon ?? []) as Array<{
    org_id: string;
    legal_name: string;
    trial_ends_at: string;
  }>;
  let remindersSent = 0;
  for (const org of expiring) {
    try {
      const { data: principal } = await serviceClient
        .from('organization_members')
        .select('user_id')
        .eq('org_id', org.org_id)
        .eq('role', 'principal')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (principal) {
        const { data: authUser } = await serviceClient.auth.admin.getUserById(principal.user_id);
        await dispatchEmail(serviceClient, {
          orgId: org.org_id,
          toAddress: authUser?.user?.email ?? null,
          templateName: 'trial_expiring_soon',
          templateVars: { legalName: org.legal_name, trialEndsAt: org.trial_ends_at },
          relatedEntityType: 'organizations',
          relatedEntityId: org.org_id,
          actorUserId: null,
        });
      }
      // Stamped even if no active principal was found -- an org with nobody to email still
      // shouldn't be re-attempted forever; that gap belongs in TECHNICAL_DEBT_REGISTER.md, not
      // an infinite retry here.
      await serviceClient
        .from('organizations')
        .update({ trial_reminder_sent_at: new Date().toISOString() })
        .eq('id', org.org_id);
      remindersSent += 1;
    } catch (err) {
      console.error('[emailDispatch] trial_expiring_soon dispatch failed', err);
    }
  }

  const { data: appliedCount, error: applyError } = await serviceClient.rpc(
    'apply_due_scheduled_plan_changes',
  );
  if (applyError) {
    return NextResponse.json(
      { error: { code: 'subscription_lifecycle_check_failed', message: applyError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    transitioned: rows.length,
    transitions: rows,
    remindersSent,
    scheduledPlanChangesApplied: appliedCount ?? 0,
  });
}
