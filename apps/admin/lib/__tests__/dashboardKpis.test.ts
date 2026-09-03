import { describe, expect, it } from 'vitest';
import { computeDashboardKpis, resolvePeriodRange, resolveSummaryMonth } from '../dashboardKpis';

// Portfolio dashboard filters pass (V1 launch-completion, this date): pure-function unit coverage
// for the plain-language KPI summary added to the main dashboard. No Supabase needed -- these are
// deliberately pure (see dashboardKpis.ts header) so this test never depends on a running local
// Supabase instance, unlike the real-integration tests elsewhere in lib/__tests__.

describe('resolvePeriodRange', () => {
  const REFERENCE = new Date(2026, 7, 27); // 27 Aug 2026 (local) -- month index 7 = August.

  it('resolves this_month to the full calendar month containing `now`', () => {
    const range = resolvePeriodRange('this_month', {}, REFERENCE);
    expect(range).toEqual({ startIso: '2026-08-01', endIso: '2026-08-31', label: 'August 2026' });
  });

  it('resolves last_month to the previous full calendar month', () => {
    const range = resolvePeriodRange('last_month', {}, REFERENCE);
    expect(range).toEqual({ startIso: '2026-07-01', endIso: '2026-07-31', label: 'July 2026' });
  });

  it('resolves last_month correctly across a January/December year boundary', () => {
    const jan = new Date(2026, 0, 15); // 15 Jan 2026
    const range = resolvePeriodRange('last_month', {}, jan);
    expect(range).toEqual({ startIso: '2025-12-01', endIso: '2025-12-31', label: 'December 2025' });
  });

  it('resolves ytd from Jan 1 through `now` (not through year end)', () => {
    const range = resolvePeriodRange('ytd', {}, REFERENCE);
    expect(range).toEqual({ startIso: '2026-01-01', endIso: '2026-08-27', label: 'Year to date 2026' });
  });

  it('resolves custom to the given from/to bounds when both are present', () => {
    const range = resolvePeriodRange('custom', { from: '2026-03-01', to: '2026-05-15' }, REFERENCE);
    expect(range).toEqual({
      startIso: '2026-03-01',
      endIso: '2026-05-15',
      label: '2026-03-01 to 2026-05-15',
    });
  });

  it('falls back to this_month when custom is missing one or both bounds', () => {
    const missingTo = resolvePeriodRange('custom', { from: '2026-03-01' }, REFERENCE);
    const missingBoth = resolvePeriodRange('custom', {}, REFERENCE);
    expect(missingTo).toEqual({ startIso: '2026-08-01', endIso: '2026-08-31', label: 'August 2026' });
    expect(missingBoth).toEqual(missingTo);
  });
});

describe('resolveSummaryMonth', () => {
  const REFERENCE = new Date(2026, 7, 27); // 27 Aug 2026

  it('anchors this_month to the containing month', () => {
    const range = resolvePeriodRange('this_month', {}, REFERENCE);
    expect(resolveSummaryMonth(range)).toEqual({ month: '2026-08-01', monthLabel: 'August 2026' });
  });

  it('anchors last_month to the previous month', () => {
    const range = resolvePeriodRange('last_month', {}, REFERENCE);
    expect(resolveSummaryMonth(range)).toEqual({ month: '2026-07-01', monthLabel: 'July 2026' });
  });

  it('anchors ytd to the month containing the range end date, not January', () => {
    const range = resolvePeriodRange('ytd', {}, REFERENCE);
    expect(resolveSummaryMonth(range)).toEqual({ month: '2026-08-01', monthLabel: 'August 2026' });
  });

  it('anchors a custom range to the month containing its end date', () => {
    const range = resolvePeriodRange('custom', { from: '2026-03-01', to: '2026-05-15' }, REFERENCE);
    expect(resolveSummaryMonth(range)).toEqual({ month: '2026-05-01', monthLabel: 'May 2026' });
  });
});

describe('computeDashboardKpis', () => {
  it('sums expected/collected/outstanding/expenses correctly and derives net income', () => {
    const summary = computeDashboardKpis({
      rentSchedulesInPeriod: [
        { dueDate: '2026-08-01', amount: 12500, status: 'paid' },
        { dueDate: '2026-08-01', amount: 8000, status: 'invoiced' },
        { dueDate: '2026-08-15', amount: 5000, status: 'overdue' },
      ],
      rentSchedulesAsOfPeriodEnd: [
        { dueDate: '2026-06-01', amount: 3000, status: 'overdue' }, // older arrears, still outstanding
        { dueDate: '2026-08-01', amount: 8000, status: 'invoiced' },
        { dueDate: '2026-08-15', amount: 5000, status: 'overdue' },
        { dueDate: '2026-08-01', amount: 12500, status: 'paid' }, // paid -- must not count as outstanding
      ],
      expensesInPeriod: [
        { amount: 1200, status: 'recorded' },
        { amount: 300, status: 'reimbursed' },
        { amount: 900, status: 'pending' }, // not yet recorded -- must be excluded
      ],
      paymentsAwaitingConfirmation: 2400,
    });

    expect(summary.expectedRent).toBe(25500); // 12500 + 8000 + 5000
    expect(summary.rentCollected).toBe(12500);
    expect(summary.outstandingRent).toBe(16000); // 3000 + 8000 + 5000, excludes the paid row
    expect(summary.expensesTotal).toBe(1500); // 1200 + 300, excludes the pending row
    expect(summary.netIncome).toBe(11000); // 12500 - 1500
    expect(summary.paymentsAwaitingConfirmation).toBe(2400);
  });

  it('returns all zeros for an empty portfolio/period without throwing', () => {
    const summary = computeDashboardKpis({
      rentSchedulesInPeriod: [],
      rentSchedulesAsOfPeriodEnd: [],
      expensesInPeriod: [],
      paymentsAwaitingConfirmation: 0,
    });
    expect(summary).toEqual({
      expectedRent: 0,
      rentCollected: 0,
      outstandingRent: 0,
      expensesTotal: 0,
      netIncome: 0,
      paymentsAwaitingConfirmation: 0,
    });
  });

  it('handles string-typed numeric amounts (Supabase numeric columns arrive as strings)', () => {
    const summary = computeDashboardKpis({
      rentSchedulesInPeriod: [{ dueDate: '2026-08-01', amount: '12500.00', status: 'paid' }],
      rentSchedulesAsOfPeriodEnd: [],
      expensesInPeriod: [{ amount: '450.50', status: 'recorded' }],
      paymentsAwaitingConfirmation: 0,
    });
    expect(summary.expectedRent).toBe(12500);
    expect(summary.rentCollected).toBe(12500);
    expect(summary.expensesTotal).toBe(450.5);
    expect(summary.netIncome).toBe(12049.5);
  });
});
