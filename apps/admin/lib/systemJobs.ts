import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { writeAuditEvent } from './audit';
import { dispatchEmail } from './emailDispatch';

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
