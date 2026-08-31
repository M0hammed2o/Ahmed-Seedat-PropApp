import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient, getAdminServerEnv } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { writeAuditEvent } from '@/lib/audit';
import {
  runSubscriptionLifecycleJob,
  runStaleCheckoutExpiryJob,
  runRentScheduleJob,
  runComplianceReminderJob,
  runPaymentAndLeaseReminderJob,
  runOwnerMonthlySummaryJob,
  runPortfolioIntelligenceJob,
} from '@/lib/systemJobs';

/**
 * POST /api/v1/system/daily-jobs (daily-job consolidation pass, WORKLOG.md this date). Single
 * orchestration endpoint replacing 3 separate Render Cron Jobs with 1 -- runs the exact same
 * lib/systemJobs.ts functions POST /api/v1/system/{check-subscriptions,generate-rent-schedules,
 * check-compliance-requirements} each already call individually (those routes are UNCHANGED and
 * stay available for manual admin use, independent testing, and any future need to run one job in
 * isolation -- this route never duplicates their logic, only sequences it).
 *
 * Same dual-auth as every other system-job route: a signed-in super_admin session, or
 * `Authorization: Bearer <CRON_JOB_SECRET>`.
 *
 * Deterministic order, each job independently transactional (no cross-job database transaction):
 * 1. subscriptions -- trial/overdue transitions + scheduled plan-change (downgrade) application.
 *    Evaluated first so an org's paid status/entitlement is current before anything downstream
 *    reads it.
 * 2. rentSchedules -- so upcoming rent obligations exist before any notification/reporting logic
 *    that might depend on them.
 * 3. compliance -- reminder sweep.
 * 4. paymentAndLeaseReminders -- rent payment reminder / overdue notice / lease expiry reminder,
 *    run after rent-schedule generation so a schedule created earlier in this same run is
 *    reminder-eligible immediately.
 * 5. ownerMonthlySummary -- reads rent_schedules/payment_reports/maintenance_tickets/leases as
 *    they stand at the end of this run.
 * 6. portfolioIntelligence (final pre-UAT engineering pass, Part 4) -- reconciles the deterministic
 *    rules-engine feed (portfolio_insights) for every org, run LAST so it reflects the day's
 *    already-settled state rather than a pre-sweep snapshot.
 *
 * Each job is caught independently: a failure in one does not stop the others (each is genuinely
 * independent of the others' own success/failure -- so skipping the remaining jobs after one
 * failure would only delay unrelated, unaffected work). The overall HTTP response is 200 only if
 * every job succeeded; any failure returns 500 with a structured per-job breakdown, never a 200
 * that silently hides a partial failure.
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
  const runStartedAt = Date.now();

  console.warn('[daily-jobs] run started', { startedAt: new Date(runStartedAt).toISOString() });

  const jobs: Record<
    | 'subscriptions'
    | 'staleCheckouts'
    | 'rentSchedules'
    | 'compliance'
    | 'paymentAndLeaseReminders'
    | 'ownerMonthlySummary'
    | 'portfolioIntelligence',
    { success: boolean; durationMs: number; result?: unknown; error?: string }
  > = {
    subscriptions: { success: false, durationMs: 0 },
    staleCheckouts: { success: false, durationMs: 0 },
    rentSchedules: { success: false, durationMs: 0 },
    compliance: { success: false, durationMs: 0 },
    paymentAndLeaseReminders: { success: false, durationMs: 0 },
    ownerMonthlySummary: { success: false, durationMs: 0 },
    portfolioIntelligence: { success: false, durationMs: 0 },
  };

  // 1. Subscription lifecycle + scheduled plan-change application.
  const subStart = Date.now();
  try {
    const result = await runSubscriptionLifecycleJob(serviceClient, actorUserId);
    jobs.subscriptions = { success: true, durationMs: Date.now() - subStart, result };
  } catch (err) {
    jobs.subscriptions = {
      success: false,
      durationMs: Date.now() - subStart,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
  console.warn('[daily-jobs] subscriptions job complete', {
    success: jobs.subscriptions.success,
    durationMs: jobs.subscriptions.durationMs,
  });

  // 1b. Final hardening pass, "Payment history UX": sweep stale (>24h, no webhook ever received)
  // pending checkouts to expired -- a display-classification hygiene job, not a billing outcome
  // change, so it never emails/audits per-org the way job 1 does.
  const staleStart = Date.now();
  try {
    const result = await runStaleCheckoutExpiryJob(serviceClient);
    jobs.staleCheckouts = { success: true, durationMs: Date.now() - staleStart, result };
  } catch (err) {
    jobs.staleCheckouts = {
      success: false,
      durationMs: Date.now() - staleStart,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
  console.warn('[daily-jobs] staleCheckouts job complete', {
    success: jobs.staleCheckouts.success,
    durationMs: jobs.staleCheckouts.durationMs,
  });

  // 2. Rent schedule generation.
  const rentStart = Date.now();
  try {
    const result = await runRentScheduleJob(serviceClient, actorUserId);
    jobs.rentSchedules = { success: true, durationMs: Date.now() - rentStart, result };
  } catch (err) {
    jobs.rentSchedules = {
      success: false,
      durationMs: Date.now() - rentStart,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
  console.warn('[daily-jobs] rentSchedules job complete', {
    success: jobs.rentSchedules.success,
    durationMs: jobs.rentSchedules.durationMs,
  });

  // 3. Compliance reminders.
  const complianceStart = Date.now();
  try {
    const result = await runComplianceReminderJob(serviceClient);
    jobs.compliance = { success: true, durationMs: Date.now() - complianceStart, result };
  } catch (err) {
    jobs.compliance = {
      success: false,
      durationMs: Date.now() - complianceStart,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
  console.warn('[daily-jobs] compliance job complete', {
    success: jobs.compliance.success,
    durationMs: jobs.compliance.durationMs,
  });

  // 4. WhatsApp V1 completion pass, Phase E: rent payment reminder / rent overdue notice / lease
  //    expiry reminder -- run last, after rent-schedule generation (2) so a schedule generated
  //    earlier in THIS SAME run is eligible for a reminder sweep in the same pass, not one run
  //    behind. dispatchWhatsApp's own template-approval gate (Phase K) means every dispatch inside
  //    this job currently returns template_not_approved rather than a real send -- the sweep still
  //    runs and stamps its own idempotency markers either way, so once Mohammed confirms approval
  //    there is no backlog to "catch up" on, only the next scheduled run sending for real.
  const remindersStart = Date.now();
  try {
    const result = await runPaymentAndLeaseReminderJob(serviceClient);
    jobs.paymentAndLeaseReminders = {
      success: true,
      durationMs: Date.now() - remindersStart,
      result,
    };
  } catch (err) {
    jobs.paymentAndLeaseReminders = {
      success: false,
      durationMs: Date.now() - remindersStart,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
  console.warn('[daily-jobs] paymentAndLeaseReminders job complete', {
    success: jobs.paymentAndLeaseReminders.success,
    durationMs: jobs.paymentAndLeaseReminders.durationMs,
  });

  // 5. Final pre-production pass, Phase 5: owner_monthly_property_summary. Run last -- reads
  //    rent_schedules/payment_reports/maintenance_tickets/leases as they stand at the end of this
  //    same run, so a schedule generated by job 2 earlier in this run is already reflected. Fully
  //    independent of every job above (no shared idempotency keys, no write-write conflicts).
  const summaryStart = Date.now();
  try {
    const result = await runOwnerMonthlySummaryJob(serviceClient);
    jobs.ownerMonthlySummary = { success: true, durationMs: Date.now() - summaryStart, result };
  } catch (err) {
    jobs.ownerMonthlySummary = {
      success: false,
      durationMs: Date.now() - summaryStart,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
  console.warn('[daily-jobs] ownerMonthlySummary job complete', {
    success: jobs.ownerMonthlySummary.success,
    durationMs: jobs.ownerMonthlySummary.durationMs,
  });

  // 6. Final pre-UAT engineering pass, Part 4: Portfolio Intelligence reconciliation. Run LAST --
  //    reflects the day's already-settled state from every job above (a rent schedule job 2/3 just
  //    flipped to overdue, a compliance requirement job 3 just marked overdue), not a stale
  //    pre-sweep snapshot. Fully independent of every job above (writes only to portfolio_insights,
  //    never a financial table), so a failure here can never corrupt or block them -- and by
  //    running last, the reverse is also already true: every job it might read from has already
  //    either succeeded or independently failed by the time this runs.
  const insightsStart = Date.now();
  try {
    const result = await runPortfolioIntelligenceJob(serviceClient);
    jobs.portfolioIntelligence = { success: true, durationMs: Date.now() - insightsStart, result };
  } catch (err) {
    jobs.portfolioIntelligence = {
      success: false,
      durationMs: Date.now() - insightsStart,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
  console.warn('[daily-jobs] portfolioIntelligence job complete', {
    success: jobs.portfolioIntelligence.success,
    durationMs: jobs.portfolioIntelligence.durationMs,
  });

  const overallSuccess =
    jobs.subscriptions.success &&
    jobs.staleCheckouts.success &&
    jobs.rentSchedules.success &&
    jobs.compliance.success &&
    jobs.paymentAndLeaseReminders.success &&
    jobs.ownerMonthlySummary.success &&
    jobs.portfolioIntelligence.success;
  const totalDurationMs = Date.now() - runStartedAt;

  console.warn('[daily-jobs] run complete', {
    success: overallSuccess,
    totalDurationMs,
    subscriptions: jobs.subscriptions.success,
    rentSchedules: jobs.rentSchedules.success,
    compliance: jobs.compliance.success,
  });

  // Reuses the existing audit_events table (governance_audit_triggers/writeAuditEvent, same
  // "system-run, org_id: null" shape rent-schedule generation already uses) rather than building
  // a new logging table for this -- only safe counts/durations/booleans, never headers, tokens,
  // or any customer-identifying data. entityId is a fresh random UUID per run, not the literal
  // string "daily" -- audit_events.entity_id is `uuid not null` (see lib/systemJobs.ts's matching
  // comment on the identical pre-existing bug found in rent_schedules.generate's own audit write).
  await writeAuditEvent(serviceClient, {
    orgId: null,
    actorUserId,
    actorType: actorUserId ? 'user' : 'system',
    action: 'system_jobs.daily_run',
    entityType: 'system_jobs',
    entityId: crypto.randomUUID(),
    after: {
      success: overallSuccess,
      totalDurationMs,
      subscriptions: {
        success: jobs.subscriptions.success,
        durationMs: jobs.subscriptions.durationMs,
      },
      rentSchedules: {
        success: jobs.rentSchedules.success,
        durationMs: jobs.rentSchedules.durationMs,
      },
      compliance: { success: jobs.compliance.success, durationMs: jobs.compliance.durationMs },
      paymentAndLeaseReminders: {
        success: jobs.paymentAndLeaseReminders.success,
        durationMs: jobs.paymentAndLeaseReminders.durationMs,
      },
      ownerMonthlySummary: {
        success: jobs.ownerMonthlySummary.success,
        durationMs: jobs.ownerMonthlySummary.durationMs,
      },
      portfolioIntelligence: {
        success: jobs.portfolioIntelligence.success,
        durationMs: jobs.portfolioIntelligence.durationMs,
      },
    },
  });

  return NextResponse.json(
    { success: overallSuccess, jobs },
    { status: overallSuccess ? 200 : 500 },
  );
}
