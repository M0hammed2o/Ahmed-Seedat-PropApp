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

/**
 * Web dashboard financial-overview pass (this date): owner_financial_summary()/
 * owner_portfolio_financial_summary() are month-granular RPCs (migrations 166/167), but the
 * dashboard's own period filter also supports ytd/custom ranges. Rather than silently picking an
 * arbitrary month for those two periods, this resolves the SAME month the filter's own resolved
 * range ends in (this_month/last_month land on their own obvious month; ytd/custom anchor to the
 * month containing the range's end date) -- and the caller always renders the resolved month's own
 * label next to the section, so it is never ambiguous which month a shown figure covers, even when
 * it doesn't match the period filter's own label one-for-one.
 */
export function resolveSummaryMonth(range: PeriodRange): { month: string; monthLabel: string } {
  const end = new Date(`${range.endIso}T00:00:00`);
  const month = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-01`;
  return { month, monthLabel: monthLabel(end) };
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
  /** every non-void expense within the period -- matches expenses' own "actually spent"
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

/**
 * Expense statuses that count toward the dashboard's Expenses/Net income cards.
 *
 * Public UAT 2026-09-07 found the dashboard contradicting itself: the Expenses card read R0 for a
 * month in which the Operating position on the SAME screen correctly used R8 850. Root cause was
 * not a legacy field -- it was a status-filter mismatch between two server-side sources. This set
 * previously held only {recorded, reimbursed}, while `owner_portfolio_financial_summary()`'s
 * `expenses_scope` CTE (migration 167/168) filters on property + invoice_date and applies NO status
 * filter at all. Every expense created through the web form lands as `pending` (status `recorded`
 * additionally requires a journal_entry_id -- see the `expenses_check` constraint), so the card
 * silently excluded every real expense while the RPC-backed figures included them.
 *
 * `void` is the one status that must never count -- a voided expense is money not spent. Everything
 * else (pending awaiting posting, recorded, reimbursed) is real committed spend for the period and
 * is what the operating-position figure already reflects.
 *
 * KNOWN RESIDUAL (needs a migration, deliberately not made here): the RPC counts `void` expenses
 * too, because it has no status filter. Once a `void` expense exists in a period, the RPC and this
 * set will disagree again by exactly that amount. The fix belongs in the RPC, not here -- see
 * PUBLIC_UAT_REPORT.md.
 */
const VOID_EXPENSE_STATUS = 'void';

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
    .filter((e) => e.status !== VOID_EXPENSE_STATUS)
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
