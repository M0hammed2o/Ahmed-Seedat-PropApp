import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllPages } from './pagedRead';

// One definition of "collected" and "outstanding" rent for the dashboard, accounting overview,
// reports, property cards and the sidebar's collection health.
//
// Before 2026-11-03 these screens counted a rent schedule as collected only when its status was
// `paid`, and as outstanding at its FULL amount while `invoiced`/`overdue`/`partial`. A part-paid
// schedule was therefore R0 collected and 100% outstanding, so "Outstanding rent" overstated the
// debtors balance (a demo org showed R225 250 against an accounts-receivable ledger of R183 500).
//
// Now, per schedule:
//   paid        = the full amount when status is `paid` (older paid schedules may have no invoice),
//                 otherwise the non-reversed invoice_payments on its invoice, capped at the amount;
//   outstanding = amount - paid, for `invoiced`/`overdue`/`partial` schedules only.
// A schedule and its invoice are linked by (lease_id, due_date) = (invoice.lease_id,
// invoice.period) -- the exact pair invoice_rent_schedule() copies at issue time (same link
// loadInvoicesWithBalances uses). Amounts are summed in cents.

export const OUTSTANDING_RENT_STATUSES: ReadonlySet<string> = new Set([
  'invoiced',
  'overdue',
  'partial',
]);

export interface ScheduleForCollection {
  lease_id: string;
  due_date: string;
  amount: number | string;
  status: string;
}

const toCents = (value: unknown) => Math.round(Number(value) * 100);
const scheduleKey = (leaseId: string, period: string) => `${leaseId}:${period}`;

/** Paid cents per `lease_id:period`, from non-void rent invoices whose period is on/after `fromPeriod`. */
export type PaidCentsByLeasePeriod = Map<string, number>;

interface InvoicePaymentsRow {
  lease_id: string;
  period: string;
  voided_at: string | null;
  invoice_payments: { amount: number | string; reversed_at: string | null }[] | null;
}

export async function loadPaidCentsByLeasePeriod(
  supabase: SupabaseClient,
  options: { fromPeriod: string; orgId?: string },
): Promise<PaidCentsByLeasePeriod> {
  const rows = await fetchAllPages<InvoicePaymentsRow>('invoice payments', (from, to) => {
    let q = supabase
      .from('invoices')
      .select('lease_id, period, voided_at, invoice_payments(amount, reversed_at)')
      .neq('source', 'manual')
      .gte('period', options.fromPeriod);
    if (options.orgId) q = q.eq('org_id', options.orgId);
    return q.order('id', { ascending: true }).range(from, to);
  });
  const paid: PaidCentsByLeasePeriod = new Map();
  for (const row of rows) {
    if (row.voided_at || !row.lease_id || !row.period) continue;
    const cents = (row.invoice_payments ?? [])
      .filter((p) => p.reversed_at === null)
      .reduce((sum, p) => sum + toCents(p.amount), 0);
    const key = scheduleKey(row.lease_id, row.period);
    paid.set(key, (paid.get(key) ?? 0) + cents);
  }
  return paid;
}

/** Earliest period whose payments a caller needs: its own window start, or the oldest unpaid schedule. */
export function earliestPeriodNeeded(
  schedules: ScheduleForCollection[],
  windowStart: string,
): string {
  let earliest = windowStart;
  for (const s of schedules) {
    if (OUTSTANDING_RENT_STATUSES.has(s.status) && s.due_date < earliest) earliest = s.due_date;
  }
  return earliest;
}

/** Rand paid against one schedule (never more than the schedule amount). */
export function schedulePaid(
  schedule: ScheduleForCollection,
  paid: PaidCentsByLeasePeriod,
): number {
  const amountCents = toCents(schedule.amount);
  if (schedule.status === 'paid') return amountCents / 100;
  const paidCents = paid.get(scheduleKey(schedule.lease_id, schedule.due_date)) ?? 0;
  return Math.min(amountCents, Math.max(0, paidCents)) / 100;
}

/** Rand still owed on one schedule; 0 unless the schedule is invoiced, overdue or partial. */
export function scheduleOutstanding(
  schedule: ScheduleForCollection,
  paid: PaidCentsByLeasePeriod,
): number {
  if (!OUTSTANDING_RENT_STATUSES.has(schedule.status)) return 0;
  return (toCents(schedule.amount) - toCents(schedulePaid(schedule, paid))) / 100;
}

export interface CollectionTotals {
  /** Sum of every schedule's amount. */
  expected: number;
  /** Received against these schedules, part-payments included (= fullyPaid + partPaid). */
  collected: number;
  /** Amount of the schedules whose status is `paid`. */
  fullyPaid: number;
  /** Part-payments received against schedules not yet fully paid. */
  partPaid: number;
  /** Balance still owed on invoiced/overdue/partial schedules. */
  outstanding: number;
}

export function summariseCollection(
  schedules: ScheduleForCollection[],
  paid: PaidCentsByLeasePeriod,
): CollectionTotals {
  let expected = 0;
  let fullyPaid = 0;
  let partPaid = 0;
  let outstanding = 0;
  for (const s of schedules) {
    expected += toCents(s.amount);
    const p = toCents(schedulePaid(s, paid));
    if (s.status === 'paid') fullyPaid += p;
    else partPaid += p;
    outstanding += toCents(scheduleOutstanding(s, paid));
  }
  return {
    expected: expected / 100,
    collected: (fullyPaid + partPaid) / 100,
    fullyPaid: fullyPaid / 100,
    partPaid: partPaid / 100,
    outstanding: outstanding / 100,
  };
}
