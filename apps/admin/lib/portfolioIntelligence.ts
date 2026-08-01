import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PortfolioInsightSeverity, PortfolioInsightType } from '@propvault/types';

// Portfolio Intelligence rules engine (AI_ARCHITECTURE.md §2) -- explicitly NOT an LLM. Every
// insight is a fixed SQL predicate over live data (§2.2); severity is a deterministic function of
// how far past its threshold the record is (§2.4), never a model's judgment. This module has no
// LLM import anywhere in its code path -- that is a design constraint, not an implementation
// detail (§2.1).
//
// `client` must be the service-role client -- this evaluates every org's data on a schedule/
// trigger, not a single authenticated user's own request, so there is no session to scope
// queries by (matches usage_events/audit_events' "written exclusively by server-side subsystems"
// pattern). No cron/scheduled-function infrastructure exists in this codebase yet
// (TECHNICAL_DEBT_REGISTER.md TD-20 already documents this exact gap for rent_schedules
// generation) -- this function is the callable, tested rules engine §2.5 describes; wiring it to
// an actual Edge Function schedule is the same open infrastructure gap as TD-20, not a new one.

interface TriggeringRecord {
  table: string;
  id: string;
  [key: string]: unknown;
}

interface EvaluatedInsight {
  insightType: PortfolioInsightType;
  key: string; // `${insightType}:${primaryRecordId}` -- natural key for reconciliation across runs
  message: string;
  dataSource: { insight_type: PortfolioInsightType; triggering_records: TriggeringRecord[] };
  severity: PortfolioInsightSeverity;
}

function daysBetween(from: string, to: Date): number {
  const fromMs = new Date(`${from}T00:00:00Z`).getTime();
  return Math.round((to.getTime() - fromMs) / 86_400_000);
}

// AI_ARCHITECTURE.md §2.4's severity table, one function per insight_type -- returns null if the
// record doesn't actually meet any tier's condition (defensive; callers only invoke this on rows
// already filtered by the tier's owning SQL predicate, so null should never occur in practice).
function severityForRentOverdue(daysOverdue: number): PortfolioInsightSeverity {
  return daysOverdue >= 7 ? 'urgent' : 'warning';
}
function severityForRentDueSoon(daysUntilDue: number): PortfolioInsightSeverity {
  if (daysUntilDue <= 0) return 'urgent';
  if (daysUntilDue <= 3) return 'warning';
  return 'info';
}
function severityForLeaseExpiring(daysUntilEnd: number): PortfolioInsightSeverity {
  if (daysUntilEnd <= 29) return 'urgent';
  if (daysUntilEnd <= 59) return 'warning';
  return 'info';
}
function severityForMaintenanceOpen(daysOpen: number, priority: string): PortfolioInsightSeverity {
  if (daysOpen >= 7 || priority === 'urgent') return 'urgent';
  if (daysOpen >= 3) return 'warning';
  return 'info';
}
function severityForInvoiceUnpaid(daysPastDue: number): PortfolioInsightSeverity {
  if (daysPastDue >= 14) return 'urgent';
  if (daysPastDue >= 7) return 'warning';
  return 'info';
}

async function evaluateRules(client: SupabaseClient, orgId: string, now: Date): Promise<EvaluatedInsight[]> {
  const today = now.toISOString().slice(0, 10);
  const insights: EvaluatedInsight[] = [];

  const [overdueResult, pendingResult, expiringLeasesResult, openTicketsResult, unpaidInvoicesResult] =
    await Promise.all([
      client
        .from('rent_schedules')
        .select('id, due_date, amount, lease_id')
        .eq('org_id', orgId)
        .eq('status', 'overdue'),
      client
        .from('rent_schedules')
        .select('id, due_date, amount, lease_id')
        .eq('org_id', orgId)
        .eq('status', 'pending')
        .gte('due_date', today), // upper bound (due within the current week) filtered in JS below
      client
        .from('leases')
        .select('id, end_date')
        .eq('org_id', orgId)
        .eq('status', 'active')
        .not('end_date', 'is', null),
      client
        .from('maintenance_tickets')
        .select('id, summary, priority, status, created_at')
        .eq('org_id', orgId)
        .in('status', ['to_do', 'in_progress', 'pending_approval']),
      client
        .from('invoices')
        .select('id, period, amount, status')
        .eq('org_id', orgId)
        .neq('status', 'paid'),
    ]);

  for (const result of [overdueResult, pendingResult, expiringLeasesResult, openTicketsResult, unpaidInvoicesResult]) {
    if (result.error) throw new Error(`Portfolio Intelligence rule query failed: ${result.error.message}`);
  }

  for (const row of overdueResult.data ?? []) {
    const daysOverdue = daysBetween(row.due_date as string, now);
    insights.push({
      insightType: 'rent_overdue',
      key: `rent_overdue:${row.id}`,
      message: `Rent of ${row.amount} is ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue (due ${row.due_date}).`,
      dataSource: {
        insight_type: 'rent_overdue',
        triggering_records: [{ table: 'rent_schedules', id: row.id as string, due_date: row.due_date, amount: row.amount }],
      },
      severity: severityForRentOverdue(daysOverdue),
    });
  }

  const weekOut = new Date(now);
  weekOut.setUTCDate(weekOut.getUTCDate() + 7);
  for (const row of pendingResult.data ?? []) {
    const dueDate = row.due_date as string;
    if (dueDate > weekOut.toISOString().slice(0, 10)) continue; // due within the current week only
    const daysUntilDue = -daysBetween(dueDate, now);
    insights.push({
      insightType: 'rent_due_soon',
      key: `rent_due_soon:${row.id}`,
      message: `Rent of ${row.amount} is due ${daysUntilDue <= 0 ? 'today' : `in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`} (${dueDate}).`,
      dataSource: {
        insight_type: 'rent_due_soon',
        triggering_records: [{ table: 'rent_schedules', id: row.id as string, due_date: dueDate, amount: row.amount }],
      },
      severity: severityForRentDueSoon(daysUntilDue),
    });
  }

  const ninetyOut = new Date(now);
  ninetyOut.setUTCDate(ninetyOut.getUTCDate() + 90);
  for (const row of expiringLeasesResult.data ?? []) {
    const endDate = row.end_date as string;
    if (endDate > ninetyOut.toISOString().slice(0, 10)) continue; // outside the 90-day lookahead window
    const daysUntilEnd = -daysBetween(endDate, now);
    if (daysUntilEnd < 0) continue; // already expired -- a different (unbuilt) concern, not "expiring soon"
    insights.push({
      insightType: 'lease_expiring',
      key: `lease_expiring:${row.id}`,
      message: `Lease ends in ${daysUntilEnd} day${daysUntilEnd === 1 ? '' : 's'} (${endDate}).`,
      dataSource: {
        insight_type: 'lease_expiring',
        triggering_records: [{ table: 'leases', id: row.id as string, end_date: endDate }],
      },
      severity: severityForLeaseExpiring(daysUntilEnd),
    });
  }

  for (const row of openTicketsResult.data ?? []) {
    const daysOpen = daysBetween((row.created_at as string).slice(0, 10), now);
    insights.push({
      insightType: 'maintenance_open',
      key: `maintenance_open:${row.id}`,
      message: `Maintenance ticket "${row.summary}" (${row.priority} priority) has been open ${daysOpen} day${daysOpen === 1 ? '' : 's'}.`,
      dataSource: {
        insight_type: 'maintenance_open',
        triggering_records: [{ table: 'maintenance_tickets', id: row.id as string, priority: row.priority, status: row.status }],
      },
      severity: severityForMaintenanceOpen(daysOpen, row.priority as string),
    });
  }

  for (const row of unpaidInvoicesResult.data ?? []) {
    const daysPastDue = daysBetween(row.period as string, now);
    if (daysPastDue < 1) continue; // not past due yet
    insights.push({
      insightType: 'invoice_unpaid',
      key: `invoice_unpaid:${row.id}`,
      message: `Invoice of ${row.amount} for period ${row.period} is ${daysPastDue} day${daysPastDue === 1 ? '' : 's'} past due.`,
      dataSource: {
        insight_type: 'invoice_unpaid',
        triggering_records: [{ table: 'invoices', id: row.id as string, period: row.period, amount: row.amount }],
      },
      severity: severityForInvoiceUnpaid(daysPastDue),
    });
  }

  return insights;
}

export interface ReconcileResult {
  inserted: number;
  updated: number;
  autoResolved: number;
}

/**
 * Evaluates every rule for one org and reconciles `portfolio_insights` (AI_ARCHITECTURE.md
 * §2.5): inserts newly-triggered conditions, updates severity/message on ones still triggering
 * (a rule's severity is time-dependent -- days-overdue grows every day the row exists), and
 * auto-dismisses ones that no longer trigger (e.g. rent that was overdue and is now paid) so the
 * feed never shows a stale insight.
 */
export async function reconcilePortfolioInsights(client: SupabaseClient, orgId: string): Promise<ReconcileResult> {
  const now = new Date();
  const fresh = await evaluateRules(client, orgId, now);
  const freshByKey = new Map(fresh.map((insight) => [insight.key, insight]));

  const { data: existingRows, error: existingError } = await client
    .from('portfolio_insights')
    .select('id, insight_type, data_source, severity, message')
    .eq('org_id', orgId)
    .is('dismissed_at', null);
  if (existingError) throw new Error(`Failed to load existing portfolio_insights: ${existingError.message}`);

  const existingByKey = new Map<string, { id: string; severity: string; message: string }>();
  for (const row of existingRows ?? []) {
    const dataSource = row.data_source as { triggering_records?: TriggeringRecord[] };
    const primaryId = dataSource.triggering_records?.[0]?.id;
    if (!primaryId) continue;
    existingByKey.set(`${row.insight_type}:${primaryId}`, {
      id: row.id as string,
      severity: row.severity as string,
      message: row.message as string,
    });
  }

  let inserted = 0;
  let updated = 0;
  let autoResolved = 0;

  const toInsert = [];
  for (const [key, insight] of freshByKey) {
    const existing = existingByKey.get(key);
    if (!existing) {
      toInsert.push({
        org_id: orgId,
        insight_type: insight.insightType,
        message: insight.message,
        data_source: insight.dataSource,
        severity: insight.severity,
        generated_at: now.toISOString(),
      });
    } else if (existing.severity !== insight.severity || existing.message !== insight.message) {
      const { error } = await client
        .from('portfolio_insights')
        .update({ message: insight.message, severity: insight.severity, generated_at: now.toISOString() })
        .eq('id', existing.id);
      if (error) throw new Error(`Failed to update portfolio_insights row ${existing.id}: ${error.message}`);
      updated += 1;
    }
  }

  if (toInsert.length > 0) {
    const { error } = await client.from('portfolio_insights').insert(toInsert);
    if (error) throw new Error(`Failed to insert portfolio_insights rows: ${error.message}`);
    inserted = toInsert.length;
  }

  const staleIds = [...existingByKey.entries()]
    .filter(([key]) => !freshByKey.has(key))
    .map(([, existing]) => existing.id);
  if (staleIds.length > 0) {
    const { error } = await client
      .from('portfolio_insights')
      .update({ dismissed_at: now.toISOString() })
      .in('id', staleIds);
    if (error) throw new Error(`Failed to auto-resolve stale portfolio_insights rows: ${error.message}`);
    autoResolved = staleIds.length;
  }

  return { inserted, updated, autoResolved };
}
