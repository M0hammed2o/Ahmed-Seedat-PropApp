// Portfolio dashboard filters pass (V1 launch-completion, this date): pure period-resolution and
// KPI-aggregation helpers extracted out of app/(dashboard)/dashboard/page.tsx so the "plain landlord
// language" summary math (Expected rent / Rent collected / Outstanding rent / Expenses / Net income
// / Payments awaiting confirmation) can be unit tested without a real Supabase instance. Every input
// here is expected to already be scoped (by org via RLS, by property via the caller's own
// lease->unit->property / property_id join) -- these functions do date-range slicing and summation
// only, never a database read.

export type DashboardPeriod = 'this_month' | 'last_month' | 'ytd' | 'custom';

export interface PeriodRange {
  /** Inclusive, YYYY-MM-DD. */
  startIso: string;
  /** Inclusive, YYYY-MM-DD. */
  endIso: string;
  label: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
}

/**
 * Resolves a DashboardPeriod (+ optional custom bounds) against a reference date into a concrete,
 * inclusive [startIso, endIso] range plus a display label. `now` is injectable so this stays a pure
 * function under test -- callers pass `new Date()` in production.
 *
 * `custom` falls back to `this_month` when either bound is missing (never a half-open range).
 */
export function resolvePeriodRange(
  period: DashboardPeriod,
  custom: { from?: string; to?: string } = {},
  now: Date = new Date(),
): PeriodRange {
  if (period === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { startIso: toIsoDate(start), endIso: toIsoDate(end), label: monthLabel(start) };
  }
  if (period === 'ytd') {
    const start = new Date(now.getFullYear(), 0, 1);
    return {
      startIso: toIsoDate(start),
      endIso: toIsoDate(now),
      label: `Year to date ${now.getFullYear()}`,
    };
  }
  if (period === 'custom' && custom.from && custom.to) {
    return { startIso: custom.from, endIso: custom.to, label: `${custom.from} to ${custom.to}` };
  }
  // 'this_month', and 'custom' without both bounds (an honest fallback, never a silent crash).
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { startIso: toIsoDate(start), endIso: toIsoDate(end), label: monthLabel(start) };
}

export interface RentScheduleLike {
  dueDate: string;
  amount: number | string;
  status: string;
}

export interface ExpenseLike {
  amount: number | string;
  status: string;
}

export interface DashboardKpiSummary {
  /** Total rent billed (every status) with a due date inside the period -- "what was scheduled." */
  expectedRent: number;
  /** The subset of expectedRent already marked `paid`. */
  rentCollected: number;
  /** invoiced/overdue/partial rows due on-or-before the period end -- a cumulative as-of figure,
   *  not "during the period" (an overdue amount from 3 months ago is still outstanding today). */
  outstandingRent: number;
  /** recorded/reimbursed expenses within the period -- matches expenses' own "actually spent"
   *  statuses, same set the existing revenue chart already uses. */
  expensesTotal: number;
  /** rentCollected - expensesTotal. A cash-basis figure, not an accrual net income. */
  netIncome: number;
  /** Passed through, not computed here -- the caller sums payment_reports.status = 'reported'
   *  rows (the one place this concept is queryable; see lib/ownerSummary.ts's own precedent for
   *  "reported" = awaiting, never folded into rentCollected). */
  paymentsAwaitingConfirmation: number;
}

const OUTSTANDING_RENT_STATUSES = new Set(['invoiced', 'overdue', 'partial']);
const RECORDED_EXPENSE_STATUSES = new Set(['recorded', 'reimbursed']);

export function computeDashboardKpis(input: {
  rentSchedulesInPeriod: RentScheduleLike[];
  rentSchedulesAsOfPeriodEnd: RentScheduleLike[];
  expensesInPeriod: ExpenseLike[];
  paymentsAwaitingConfirmation: number;
}): DashboardKpiSummary {
  const expectedRent = input.rentSchedulesInPeriod.reduce((sum, r) => sum + Number(r.amount), 0);
  const rentCollected = input.rentSchedulesInPeriod
    .filter((r) => r.status === 'paid')
    .reduce((sum, r) => sum + Number(r.amount), 0);
  const outstandingRent = input.rentSchedulesAsOfPeriodEnd
    .filter((r) => OUTSTANDING_RENT_STATUSES.has(r.status))
    .reduce((sum, r) => sum + Number(r.amount), 0);
  const expensesTotal = input.expensesInPeriod
    .filter((e) => RECORDED_EXPENSE_STATUSES.has(e.status))
    .reduce((sum, e) => sum + Number(e.amount), 0);

  return {
    expectedRent,
    rentCollected,
    outstandingRent,
    expensesTotal,
    netIncome: rentCollected - expensesTotal,
    paymentsAwaitingConfirmation: input.paymentsAwaitingConfirmation,
  };
}
