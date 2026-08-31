import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { writeAuditEvent } from './audit';
import { dispatchEmail } from './emailDispatch';
import {
  dispatchWhatsApp,
  resolvePropertyLabelForLease,
  resolvePropertyLabelForUnit,
  formatPaymentPeriod,
} from './whatsappDispatch';
import {
  buildRentPaymentReminderVariables,
  buildRentOverdueNoticeVariables,
  buildLeaseExpiryReminderVariables,
  buildOwnerMonthlyPropertySummaryVariables,
} from './whatsappTemplateVariables';
import { getAppUrl } from './appUrl';
import {
  resolveEligibleSummaryOwners,
  getOrCreateOwnerMonthlySummary,
  markOwnerMonthlySummarySent,
  resolveCalendarMonthPeriod,
  formatSummaryMonthLabel,
} from './ownerSummary';
import { reconcilePortfolioInsights } from './portfolioIntelligence';
import { notifyPropertyStaff } from './notify';

/**
 * Daily system-job consolidation (WORKLOG.md this date). The ONE place each scheduled job's real
 * logic lives -- POST /api/v1/system/{check-subscriptions,generate-rent-schedules,
 * check-compliance-requirements} and POST /api/v1/system/daily-jobs all call these same three
 * functions, never a re-implementation of their own. Each function is independently idempotent
 * (re-running it is always safe -- see each function's own comment for exactly why) and throws a
 * real Error on failure; callers decide how to translate that into an HTTP response.
 */

// ============================================================
// 1. Subscription lifecycle + scheduled plan-change application
// ============================================================
export interface SubscriptionLifecycleJobResult {
  transitioned: number;
  transitions: Array<{
    org_id: string;
    previous_status: string;
    new_status: string;
    reason: string;
  }>;
  remindersSent: number;
  scheduledPlanChangesApplied: number;
}

/**
 * 1. expire_trials_and_suspend_overdue() (20260101000076) -- transitions trials past
 *    trial_ends_at, and orgs overdue for more than 7 days, to 'suspended'. Audit-logs and emails
 *    the org's principal for every org actually transitioned.
 * 2. trials_expiring_soon() -- reminder email to any trial org expiring within 3 days that hasn't
 *    already been reminded, then stamps trial_reminder_sent_at so it is never reminded twice.
 * 3. apply_due_scheduled_plan_changes() (20260101000104, RELEASE A) -- applies every SCHEDULED
 *    downgrade whose effective_at has arrived. Idempotent by construction: a row leaves
 *    status='scheduled' the moment it's applied, so re-running this is always safe.
 */
export async function runSubscriptionLifecycleJob(
  serviceClient: SupabaseClient,
  actorUserId: string | null,
): Promise<SubscriptionLifecycleJobResult> {
  const { data: transitions, error: transitionsError } = await serviceClient.rpc(
    'expire_trials_and_suspend_overdue',
  );
  if (transitionsError) throw new Error(transitionsError.message);

  const rows = (transitions ?? []) as SubscriptionLifecycleJobResult['transitions'];

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
    // to restore it. Never blocks/fails the run -- same "log, don't throw" boundary as every
    // other dispatchEmail() call site.
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
  if (expiringSoonError) throw new Error(expiringSoonError.message);

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
      // shouldn't be re-attempted forever.
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
  if (applyError) throw new Error(applyError.message);

  return {
    transitioned: rows.length,
    transitions: rows,
    remindersSent,
    scheduledPlanChangesApplied: appliedCount ?? 0,
  };
}

// ============================================================
// 1b. Stale checkout expiry (final hardening pass, "Payment history UX")
// ============================================================
export interface StaleCheckoutExpiryJobResult {
  expired: number;
}

/**
 * expire_stale_subscription_checkouts() (migration 155) -- a plain hygiene sweep, not a
 * customer-facing lifecycle event, so unlike runSubscriptionLifecycleJob() above this never
 * writes an audit_events row or sends email: no billing outcome changed, only the display
 * classification of an already-abandoned checkout attempt. Idempotent (only ever moves
 * status='pending' rows past the age threshold; a row already 'expired' is never matched again).
 */
export async function runStaleCheckoutExpiryJob(
  serviceClient: SupabaseClient,
): Promise<StaleCheckoutExpiryJobResult> {
  const { data, error } = await serviceClient.rpc('expire_stale_subscription_checkouts', {
    p_max_age_hours: 24,
  });
  if (error) throw new Error(error.message);
  return { expired: (data as number) ?? 0 };
}

// ============================================================
// 2. Rent schedule generation
// ============================================================
export interface RentScheduleJobResult {
  through: string;
  leasesProcessed: number;
  leasesWithNewRows: number;
  totalCreated: number;
  createdByOrg: Record<string, number>;
}

/**
 * generate_rent_schedules_for_active_leases() -- idempotent by a real
 * unique(lease_id, due_date) constraint with `on conflict do nothing` (20260101000050), not merely
 * assumed: re-running this for the same horizon creates zero additional rows for a lease that
 * already has them.
 */
export async function runRentScheduleJob(
  serviceClient: SupabaseClient,
  actorUserId: string | null,
  horizonMonths = 1,
): Promise<RentScheduleJobResult> {
  const throughDate = new Date();
  throughDate.setMonth(throughDate.getMonth() + horizonMonths);
  const throughIso = throughDate.toISOString().slice(0, 10);

  const { data, error } = await serviceClient.rpc('generate_rent_schedules_for_active_leases', {
    p_through: throughIso,
  });
  if (error) throw new Error(error.message);

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
    // Pre-existing bug found while extracting this into a shared function (WORKLOG.md this date):
    // audit_events.entity_id is `uuid not null` (20260101000013/043) -- the literal string 'bulk'
    // has ALWAYS failed that insert, silently, since writeAuditEvent only console.errors on
    // failure rather than throwing. This is a bulk operation with no single row to reference, so a
    // fresh random UUID per run is the correct fix (not a schema change) -- it satisfies the
    // column's real type without pretending to point at an entity that doesn't exist.
    entityId: crypto.randomUUID(),
    after: {
      through: throughIso,
      leases_processed: rows.length,
      leases_with_new_rows: leasesWithNewRows,
      total_created: totalCreated,
    },
  });

  return {
    through: throughIso,
    leasesProcessed: rows.length,
    leasesWithNewRows,
    totalCreated,
    createdByOrg: byOrg,
  };
}

// ============================================================
// 3. Compliance requirement reminders
// ============================================================
export interface ComplianceReminderJobResult {
  dueSoonRemindersSent: number;
  overdueRemindersSent: number;
}

interface ComplianceRequirementRow {
  id: string;
  org_id: string;
  tenant_id: string;
  due_at: string | null;
  rule_version_id: string;
}

async function sendComplianceReminders(
  serviceClient: SupabaseClient,
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
      // still shouldn't be re-attempted on every future run. This stamp is also what makes this
      // sweep idempotent: a requirement already stamped is excluded by the RPCs' own WHERE
      // clause, so a duplicate invocation sends zero additional reminders for it.
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

/**
 * Two independent sweeps, each stamping its own idempotency marker
 * (due_reminder_sent_at/overdue_reminder_sent_at, 20260101000099) so re-running the same window
 * never double-sends:
 * 1. compliance_requirements_due_soon(3) -- requirements due within 3 days, not yet reminded.
 * 2. compliance_requirements_overdue_unreminded() -- requirements already past due, not yet
 *    reminded.
 */
export async function runComplianceReminderJob(
  serviceClient: SupabaseClient,
): Promise<ComplianceReminderJobResult> {
  const [dueSoonResult, overdueResult] = await Promise.all([
    serviceClient.rpc('compliance_requirements_due_soon', { p_within_days: 3 }),
    serviceClient.rpc('compliance_requirements_overdue_unreminded'),
  ]);
  if (dueSoonResult.error) throw new Error(dueSoonResult.error.message);
  if (overdueResult.error) throw new Error(overdueResult.error.message);

  const dueSoonSent = await sendComplianceReminders(
    serviceClient,
    dueSoonResult.data ?? [],
    'compliance_requirement_due_soon',
    'due_reminder_sent_at',
  );
  const overdueSent = await sendComplianceReminders(
    serviceClient,
    overdueResult.data ?? [],
    'compliance_requirement_overdue',
    'overdue_reminder_sent_at',
  );

  return {
    dueSoonRemindersSent: dueSoonSent,
    overdueRemindersSent: overdueSent,
  };
}

// ============================================================
// 4. WhatsApp V1 completion pass, Phase E (WORKLOG.md this date): rent payment reminder / rent
//    overdue notice / lease expiry reminder. Mirrors sendComplianceReminders()'s exact sweep ->
//    dispatch -> stamp-idempotency-marker shape above, integrated into the SAME daily-jobs
//    endpoint rather than a new Render cron, per this pass's own explicit instruction. All three
//    RPCs (rent_schedules_due_soon/rent_schedules_overdue_unreminded/leases_expiring_unreminded,
//    migration 20260101000106) already exclude any schedule with a payment_reports row currently
//    `reported` -- a reminder/overdue notice is never sent while a tenant-submitted payment might
//    already cover it, this pass's own explicit "do not send if a payment is merely awaiting
//    confirmation" instruction.
// ============================================================
export interface PaymentAndLeaseReminderJobResult {
  rentRemindersSent: number;
  rentOverdueNoticesSent: number;
  leaseExpiryRemindersSent: number;
}

interface PrimaryTenantContact {
  phone: string | null;
  userId: string | null;
  fullName: string | null;
}

async function resolvePrimaryTenantContact(
  serviceClient: SupabaseClient,
  leaseId: string,
): Promise<PrimaryTenantContact | null> {
  const { data } = await serviceClient
    .from('lease_tenants')
    .select('tenants(phone, user_id, full_name)')
    .eq('lease_id', leaseId)
    .eq('is_primary', true)
    .maybeSingle();
  const tenant = (
    data as unknown as {
      tenants: { phone: string | null; user_id: string | null; full_name: string | null } | null;
    } | null
  )?.tenants;
  if (!tenant) return null;
  return { phone: tenant.phone, userId: tenant.user_id, fullName: tenant.full_name };
}

// V1 launch-completion pass (WORKLOG.md this date): the overdue/expiring RPC rows below
// (rent_schedules_overdue_unreminded/leases_expiring_unreminded) carry lease_id/unit_id but not
// property_id directly -- resolvePropertyLabelForLease/resolvePropertyLabelForUnit (whatsappDispatch.ts)
// already do the same join for a display label; these two mirror that join to get the raw
// property_id needed for notifyPropertyStaff()'s property_access scoping.
async function resolvePropertyIdForLease(
  serviceClient: SupabaseClient,
  leaseId: string,
): Promise<string | null> {
  const { data } = await serviceClient
    .from('leases')
    .select('units(property_id)')
    .eq('id', leaseId)
    .maybeSingle();
  const unit = (data as unknown as { units: { property_id: string } | null } | null)?.units;
  return unit?.property_id ?? null;
}

async function resolvePropertyIdForUnit(
  serviceClient: SupabaseClient,
  unitId: string,
): Promise<string | null> {
  const { data } = await serviceClient
    .from('units')
    .select('property_id')
    .eq('id', unitId)
    .maybeSingle();
  return (data as { property_id: string } | null)?.property_id ?? null;
}

export async function runPaymentAndLeaseReminderJob(
  serviceClient: SupabaseClient,
): Promise<PaymentAndLeaseReminderJobResult> {
  const [dueSoonResult, overdueResult, expiringResult] = await Promise.all([
    serviceClient.rpc('rent_schedules_due_soon', { p_within_days: 3 }),
    serviceClient.rpc('rent_schedules_overdue_unreminded'),
    serviceClient.rpc('leases_expiring_unreminded', { p_within_days: 30 }),
  ]);
  if (dueSoonResult.error) throw new Error(dueSoonResult.error.message);
  if (overdueResult.error) throw new Error(overdueResult.error.message);
  if (expiringResult.error) throw new Error(expiringResult.error.message);

  type RentScheduleRow = {
    id: string;
    org_id: string;
    lease_id: string;
    due_date: string;
    amount: number;
  };
  type LeaseRow = { id: string; org_id: string; unit_id: string; end_date: string };

  let rentRemindersSent = 0;
  for (const row of (dueSoonResult.data ?? []) as RentScheduleRow[]) {
    try {
      const tenant = await resolvePrimaryTenantContact(serviceClient, row.lease_id);
      const propertyLabel = await resolvePropertyLabelForLease(serviceClient, row.lease_id);
      // Final Meta template reconciliation (WORKLOG.md 2026-08-17): the real approved body is
      // "{{1}} is due for {{2}} on {{3}}" -- amount, THEN payment period (month), THEN the exact
      // due date -- followed by property and a link. Corrects the earlier unverified 3-var guess
      // (organizationName, amount, dueDate), which Mohammed confirmed was wrong.
      await dispatchWhatsApp(serviceClient, {
        orgId: row.org_id,
        toPhone: tenant?.phone ?? null,
        toUserId: tenant?.userId ?? null,
        templateName: 'rent_payment_reminder',
        variables: buildRentPaymentReminderVariables({
          amount: String(row.amount),
          paymentPeriod: formatPaymentPeriod(row.due_date),
          dueDate: new Date(row.due_date).toLocaleDateString('en-ZA'),
          propertyLabel,
          accountLink: `${getAppUrl()}/my-payments`,
        }),
        relatedEntityType: 'rent_schedule:reminder',
        relatedEntityId: row.id,
        actorUserId: null,
      });
    } catch (err) {
      console.error('[whatsappDispatch] rent_payment_reminder dispatch failed', err);
    }
    await serviceClient
      .from('rent_schedules')
      .update({ rent_reminder_sent_at: new Date().toISOString() })
      .eq('id', row.id);
    rentRemindersSent += 1;
  }

  let rentOverdueNoticesSent = 0;
  for (const row of (overdueResult.data ?? []) as RentScheduleRow[]) {
    try {
      const tenant = await resolvePrimaryTenantContact(serviceClient, row.lease_id);
      const propertyLabel = await resolvePropertyLabelForLease(serviceClient, row.lease_id);
      // Final pre-production pass (WORKLOG.md 2026-08-17): real approved structure confirmed by
      // Mohammed -- outstandingAmount, tenantName, propertyLabel, paymentPeriod, accountLink.
      await dispatchWhatsApp(serviceClient, {
        orgId: row.org_id,
        toPhone: tenant?.phone ?? null,
        toUserId: tenant?.userId ?? null,
        templateName: 'rent_overdue_notice',
        variables: buildRentOverdueNoticeVariables({
          outstandingAmount: String(row.amount),
          tenantName: tenant?.fullName ?? 'Tenant',
          propertyLabel,
          paymentPeriod: formatPaymentPeriod(row.due_date),
          accountLink: `${getAppUrl()}/my-payments`,
        }),
        relatedEntityType: 'rent_schedule:overdue',
        relatedEntityId: row.id,
        actorUserId: null,
      });

      // Notify property staff (agent+) alongside the tenant's WhatsApp notice -- reuses this same
      // per-row iteration over rent_schedules_overdue_unreminded() (only unreminded rows) as its
      // "don't spam every cron run" guard, exactly like the WhatsApp send above; both are stamped
      // by the single overdue_notice_sent_at update below, so this fires at most once per schedule.
      await notifyPropertyStaff(serviceClient, {
        orgId: row.org_id,
        propertyId: await resolvePropertyIdForLease(serviceClient, row.lease_id),
        type: 'rent_overdue',
        title: 'Rent overdue',
        body: `${tenant?.fullName ?? 'A tenant'} at ${propertyLabel} has overdue rent for ${formatPaymentPeriod(row.due_date)}.`,
        relatedEntityType: 'rent_schedule',
        relatedEntityId: row.id,
      });
    } catch (err) {
      console.error('[whatsappDispatch] rent_overdue_notice dispatch failed', err);
    }
    await serviceClient
      .from('rent_schedules')
      .update({ overdue_notice_sent_at: new Date().toISOString() })
      .eq('id', row.id);
    rentOverdueNoticesSent += 1;
  }

  let leaseExpiryRemindersSent = 0;
  for (const row of (expiringResult.data ?? []) as LeaseRow[]) {
    try {
      const tenant = await resolvePrimaryTenantContact(serviceClient, row.id);
      const propertyLabel = await resolvePropertyLabelForUnit(serviceClient, row.unit_id);
      // Final pre-production pass (WORKLOG.md 2026-08-17): real approved structure confirmed by
      // Mohammed -- tenantName, propertyLabel, expiryDate, leaseLink.
      await dispatchWhatsApp(serviceClient, {
        orgId: row.org_id,
        toPhone: tenant?.phone ?? null,
        toUserId: tenant?.userId ?? null,
        templateName: 'lease_expiry_reminder',
        variables: buildLeaseExpiryReminderVariables({
          tenantName: tenant?.fullName ?? 'Tenant',
          propertyLabel,
          expiryDate: row.end_date,
          leaseLink: `${getAppUrl()}/my-lease`,
        }),
        relatedEntityType: 'lease:expiry_reminder',
        relatedEntityId: row.id,
        actorUserId: null,
      });

      // Notify property staff (agent+) alongside the tenant's WhatsApp reminder -- reuses this
      // same per-row iteration over leases_expiring_unreminded() (only unreminded rows) as its
      // "don't spam every cron run" guard, stamped once by expiry_reminder_sent_at below.
      await notifyPropertyStaff(serviceClient, {
        orgId: row.org_id,
        propertyId: await resolvePropertyIdForUnit(serviceClient, row.unit_id),
        type: 'lease_expiring',
        title: 'Lease expiring soon',
        body: `${tenant?.fullName ?? 'A tenant'}'s lease at ${propertyLabel} expires on ${new Date(row.end_date).toLocaleDateString('en-ZA')}.`,
        relatedEntityType: 'lease',
        relatedEntityId: row.id,
      });
    } catch (err) {
      console.error('[whatsappDispatch] lease_expiry_reminder dispatch failed', err);
    }
    await serviceClient
      .from('leases')
      .update({ expiry_reminder_sent_at: new Date().toISOString() })
      .eq('id', row.id);
    leaseExpiryRemindersSent += 1;
  }

  return { rentRemindersSent, rentOverdueNoticesSent, leaseExpiryRemindersSent };
}

// ============================================================
// 5. Owner monthly property summary -- final pre-production pass, Phase 5 (WORKLOG.md this date).
//    Idempotent across duplicate runs on two levels: (a) owner_property_summaries has a unique
//    (owner_user_id, period_start) constraint, so the financial snapshot is computed at most once
//    per owner per month regardless of how many times this job runs that month; (b) dispatchWhatsApp
//    itself is idempotent on (relatedEntityType, relatedEntityId, templateName), so even a crash
//    between markOwnerMonthlySummarySent() and the next run can never double-send. A new snapshot
//    is only ever CREATED on the owner's own preferred day (default: 1st of the month, migration
//    20260101000107's notification_preferences.preferred_summary_day) -- but once it exists, an
//    unsent one (sent_at still null, e.g. because the template was unapproved that day) is retried
//    on every subsequent run regardless of day-of-month, so a mid-month template approval doesn't
//    force owners to wait for next month's cycle.
// ============================================================
export interface OwnerMonthlySummaryJobResult {
  summariesGenerated: number;
  summariesSent: number;
}

export async function runOwnerMonthlySummaryJob(
  serviceClient: SupabaseClient,
): Promise<OwnerMonthlySummaryJobResult> {
  const today = new Date();
  const { periodStart, periodEnd } = resolveCalendarMonthPeriod(today);
  const dayOfMonth = today.getUTCDate();

  const owners = await resolveEligibleSummaryOwners(serviceClient);

  let summariesGenerated = 0;
  let summariesSent = 0;

  for (const owner of owners) {
    try {
      const { data: pref } = await serviceClient
        .from('notification_preferences')
        .select('whatsapp_enabled, preferred_summary_day')
        .eq('user_id', owner.ownerUserId)
        .eq('category', 'owner_summary')
        .maybeSingle();
      // Missing row = default enabled, matching dispatchWhatsApp's own convention. An explicit
      // opt-out here means this owner isn't even sent a summary to review later -- there is no
      // other delivery channel for this template today, so "disabled" genuinely means "skip".
      if (pref && pref.whatsapp_enabled === false) continue;

      const preferredDay = pref?.preferred_summary_day ?? 1;

      const { data: existing } = await serviceClient
        .from('owner_property_summaries')
        .select('id, sent_at')
        .eq('owner_user_id', owner.ownerUserId)
        .eq('period_start', periodStart)
        .maybeSingle();

      if (!existing && dayOfMonth !== preferredDay) continue;
      if (existing?.sent_at) continue;

      const summary = await getOrCreateOwnerMonthlySummary(serviceClient, {
        ownerId: owner.ownerId,
        ownerUserId: owner.ownerUserId,
        orgId: owner.orgId,
        periodStart,
        periodEnd,
      });
      if (!existing) summariesGenerated += 1;

      const reportUrl = `${getAppUrl()}/owner-portal/summary/${summary.id}`;
      // Final pre-production pass (WORKLOG.md 2026-08-17): real approved structure confirmed by
      // Mohammed -- 9 vars, no organizationName (the earlier draft's own guess wrongly prepended
      // one that doesn't belong to this template).
      const result = await dispatchWhatsApp(serviceClient, {
        orgId: owner.orgId,
        toPhone: owner.phone,
        toUserId: owner.ownerUserId,
        templateName: 'owner_monthly_property_summary',
        variables: buildOwnerMonthlyPropertySummaryVariables({
          month: formatSummaryMonthLabel(periodStart),
          propertyCount: String(summary.propertyCount),
          expectedRent: summary.expectedRent.toFixed(2),
          confirmedPaid: summary.confirmedPaid.toFixed(2),
          outstanding: summary.outstanding.toFixed(2),
          awaitingConfirmation: summary.awaitingConfirmation.toFixed(2),
          openMaintenance: String(summary.openMaintenanceCount),
          upcomingLeaseExpiries: String(summary.upcomingLeaseExpiryCount),
          reportUrl,
        }),
        relatedEntityType: 'owner_property_summary',
        relatedEntityId: summary.id,
        actorUserId: null,
      });
      if (result.sent && result.whatsappMessageId) {
        await markOwnerMonthlySummarySent(serviceClient, {
          summaryId: summary.id,
          whatsappMessageId: result.whatsappMessageId,
        });
        summariesSent += 1;
      }
    } catch (err) {
      console.error('[whatsappDispatch] owner_monthly_property_summary dispatch failed', err);
    }
  }

  return { summariesGenerated, summariesSent };
}

// ============================================================
// 6. Portfolio Intelligence -- reconciles the deterministic rules-engine feed (AI_ARCHITECTURE.md
//    §2) for every org. Final pre-UAT engineering pass (WORKLOG.md this date): reconcilePortfolioInsights()
//    (lib/portfolioIntelligence.ts) has existed, fully implemented and per-org, since an earlier
//    pass but was NEVER invoked by any production code path -- confirmed by a repo-wide grep
//    finding zero call sites anywhere, not even a test file (TECHNICAL_DEBT_REGISTER.md TD-20).
//    This wires it into the existing consolidated daily-jobs sweep, per this pass's own explicit
//    instruction NOT to create a second Render Cron Job.
// ============================================================
export interface PortfolioIntelligenceJobResult {
  orgsProcessed: number;
  orgsFailed: number;
  orgsSkippedOverCap: number;
  totalInserted: number;
  totalUpdated: number;
  totalAutoResolved: number;
}

// Bounded processing (this pass's own explicit requirement): a naive fully-sequential per-org
// loop was found live to take ~9s against 266 orgs in this environment's own long-lived local dev
// database -- long enough to threaten an HTTP-request-scoped cron endpoint's own timeout as org
// count grows. Two independent bounds, not one: CONCURRENCY runs a small batch of orgs' own
// independent queries in parallel rather than one at a time (the real fix -- Postgres/Supabase has
// no problem serving 10 concurrent orgs' worth of read queries at once); MAX_ORGS_PER_RUN is a
// hard ceiling so a single run can never process an unbounded number of orgs regardless of org
// count -- any excess orgs are simply picked up by the next scheduled run (a delayed insight
// refresh, never a silently-dropped one), reported back as `orgsSkippedOverCap` rather than
// pretending the sweep was complete.
const PORTFOLIO_INTELLIGENCE_CONCURRENCY = 10;
const PORTFOLIO_INTELLIGENCE_MAX_ORGS_PER_RUN = 500;

/**
 * Runs last in the daily-jobs order (after subscriptions/rent schedules/compliance/reminders/
 * owner summaries) -- Portfolio Intelligence insights are meant to reflect the DAY'S already-
 * settled state (a rent schedule the compliance/reminder jobs just flipped to overdue, a
 * compliance requirement the compliance job just marked overdue), not a stale pre-sweep snapshot.
 * Per-org try/catch (matching runPaymentAndLeaseReminderJob's own per-row isolation, extended to
 * per-org here): one org's failure -- a malformed row, a transient query error -- is logged and
 * skipped, never allowed to abort the batch or corrupt/block any other job in the same daily-jobs
 * run (this pass's own explicit "failure in intelligence must not corrupt financial jobs"
 * requirement -- this job runs strictly after every financial job has already completed its own
 * independent try/catch in the route, so a Portfolio Intelligence failure literally cannot affect
 * them). Excludes archived orgs only (removed from active billing/usage, per DATABASE.md) --
 * trial/active/overdue/suspended/cancelled orgs all still get insights, matching the grace-period
 * access policy that suspended/cancelled orgs retain read access.
 */
export async function runPortfolioIntelligenceJob(
  serviceClient: SupabaseClient,
): Promise<PortfolioIntelligenceJobResult> {
  const { data: orgs, error } = await serviceClient
    .from('organizations')
    .select('id')
    .neq('status', 'archived')
    .order('id', { ascending: true })
    .limit(PORTFOLIO_INTELLIGENCE_MAX_ORGS_PER_RUN + 1);
  if (error) throw new Error(error.message);

  const allOrgs = orgs ?? [];
  const orgsOverCap = allOrgs.length > PORTFOLIO_INTELLIGENCE_MAX_ORGS_PER_RUN;
  const orgsToProcess = orgsOverCap
    ? allOrgs.slice(0, PORTFOLIO_INTELLIGENCE_MAX_ORGS_PER_RUN)
    : allOrgs;

  let orgsProcessed = 0;
  let orgsFailed = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalAutoResolved = 0;

  for (let i = 0; i < orgsToProcess.length; i += PORTFOLIO_INTELLIGENCE_CONCURRENCY) {
    const batch = orgsToProcess.slice(i, i + PORTFOLIO_INTELLIGENCE_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((org) => reconcilePortfolioInsights(serviceClient, org.id as string)),
    );
    for (let j = 0; j < results.length; j += 1) {
      const outcome = results[j]!;
      if (outcome.status === 'fulfilled') {
        orgsProcessed += 1;
        totalInserted += outcome.value.inserted;
        totalUpdated += outcome.value.updated;
        totalAutoResolved += outcome.value.autoResolved;
      } else {
        orgsFailed += 1;
        console.error(
          '[portfolioIntelligence] reconcile failed for org',
          batch[j]!.id,
          outcome.reason,
        );
      }
    }
  }

  const orgsSkippedOverCap = orgsOverCap
    ? allOrgs.length - PORTFOLIO_INTELLIGENCE_MAX_ORGS_PER_RUN
    : 0;
  if (orgsSkippedOverCap > 0) {
    console.warn(
      `[portfolioIntelligence] ${orgsSkippedOverCap} org(s) exceeded PORTFOLIO_INTELLIGENCE_MAX_ORGS_PER_RUN (${PORTFOLIO_INTELLIGENCE_MAX_ORGS_PER_RUN}) and were deferred to the next run`,
    );
  }
  return {
    orgsProcessed,
    orgsFailed,
    orgsSkippedOverCap,
    totalInserted,
    totalUpdated,
    totalAutoResolved,
  };
}
