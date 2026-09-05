/** Phase A budget-hierarchy pass (WORKLOG.md this date): derives an annual planned/actual/
 *  remaining/% used rollup from 12 already-fetched monthly figures. Pure summation over
 *  server-authoritative per-month data (budget_vs_actual()/owner_portfolio_financial_summary()) --
 *  never an independent source of truth, and never computed client-side (Android and web both
 *  read this same server-computed object, never re-summing months themselves). */
export interface AnnualBudgetSummary {
  year: number;
  monthsPlanned: number;
  annualPlanned: number;
  annualActual: number;
  annualRemaining: number;
  annualPercentUsed: number | null;
}

export function summarizeAnnualBudget(
  year: number,
  months: { plannedAmount: number | null; actualAmount: number }[],
): AnnualBudgetSummary {
  const monthsPlanned = months.filter((m) => m.plannedAmount !== null).length;
  const annualPlanned = months.reduce((sum, m) => sum + (m.plannedAmount ?? 0), 0);
  const annualActual = months.reduce((sum, m) => sum + m.actualAmount, 0);
  return {
    year,
    monthsPlanned,
    annualPlanned,
    annualActual,
    annualRemaining: annualPlanned - annualActual,
    annualPercentUsed: annualPlanned === 0 ? null : Math.round((annualActual / annualPlanned) * 1000) / 10,
  };
}
