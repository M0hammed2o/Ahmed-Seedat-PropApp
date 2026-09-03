import type { OwnerFinancialSummary, BudgetAlert } from '@propvault/types';
import type { getServerSupabaseClient } from '@/lib/supabase/server';

// Web owner financial dashboard pass (this date, per UTILITIES_RATES_BUDGET_GAP_AUDIT.md's own
// finding that owner_financial_summary()/owner_portfolio_financial_summary() -- migrations 166/167
// -- were fully built and wired into API routes but never actually called by any web page). This
// is the one place the web dashboard and the property detail page both go for the server-
// authoritative month figures (rent, utilities/rates&levies/other expenses, budget, operating
// position) -- calls the RPC directly (this runs in server components, not over HTTP) rather than
// re-deriving any of it from raw table rows, so the web app never shows "a different financial
// truth" than the RPC's own definition. Returns null (never a fabricated zero) on any RPC error --
// callers render an honest "not available" state, same rule DashboardData's own portfolioValue
// field already follows.

const BUDGET_APPROACHING_THRESHOLD_PERCENT = 80;

interface PropertySummaryRow {
  rent_planned: string;
  rent_collected: string;
  rent_outstanding: string;
  utilities_expense: string;
  water_expense: string;
  electricity_expense: string;
  rates_and_levies_expense: string;
  rates_taxes_expense: string;
  levies_expense: string;
  other_expenses: string;
  total_expenses: string;
  awaiting_confirmation_count: number;
}

interface PortfolioSummaryRow extends PropertySummaryRow {
  budget_planned: string;
  budget_actual: string;
  budget_remaining: string;
  budget_used_percent: string | null;
  net_operating_position: string;
  property_count: number;
}

interface BudgetVsActualRow {
  budget_id: string | null;
  planned_amount: string | null;
  actual_amount: string;
  remaining_amount: string | null;
  variance_amount: string | null;
  percent_used: string | null;
}

type SupabaseClient = Awaited<ReturnType<typeof getServerSupabaseClient>>;

function budgetAlertsFor(
  scopeId: string,
  month: string,
  budgetUsedPercent: number | null,
): BudgetAlert[] {
  if (budgetUsedPercent === null) return [];
  if (budgetUsedPercent >= 100) {
    return [{ propertyId: scopeId, month, level: 'exceeded', percentUsed: budgetUsedPercent }];
  }
  if (budgetUsedPercent >= BUDGET_APPROACHING_THRESHOLD_PERCENT) {
    return [{ propertyId: scopeId, month, level: 'approaching', percentUsed: budgetUsedPercent }];
  }
  return [];
}

/** Property-scoped: owner_financial_summary() + budget_vs_actual(), the same pair
 *  GET /api/v1/properties/:id/financial-summary composes -- called directly here instead of via
 *  HTTP since this always runs from a server component. */
export async function loadPropertyFinancialOverview(
  supabase: SupabaseClient,
  propertyId: string,
  month: string,
): Promise<OwnerFinancialSummary | null> {
  const [summaryResult, budgetResult] = await Promise.all([
    supabase.rpc('owner_financial_summary', { p_property_id: propertyId, p_month: month }).maybeSingle(),
    supabase.rpc('budget_vs_actual', { p_property_id: propertyId, p_month: month }).maybeSingle(),
  ]);
  if (summaryResult.error) return null;

  const summary = summaryResult.data as PropertySummaryRow | null;
  const budget = budgetResult.data as BudgetVsActualRow | null;
  const rentCollected = Number(summary?.rent_collected ?? 0);
  const totalExpenses = Number(summary?.total_expenses ?? 0);
  const budgetPlanned =
    budget?.planned_amount === null || budget?.planned_amount === undefined
      ? null
      : Number(budget.planned_amount);
  const budgetUsedPercent =
    budget?.percent_used === null || budget?.percent_used === undefined
      ? null
      : Number(budget.percent_used);
  const budgetRemaining =
    budget?.remaining_amount === null || budget?.remaining_amount === undefined
      ? null
      : Number(budget.remaining_amount);

  return {
    propertyId,
    month,
    rentPlanned: Number(summary?.rent_planned ?? 0),
    rentCollected,
    rentOutstanding: Number(summary?.rent_outstanding ?? 0),
    utilitiesExpense: Number(summary?.utilities_expense ?? 0),
    waterExpense: Number(summary?.water_expense ?? 0),
    electricityExpense: Number(summary?.electricity_expense ?? 0),
    ratesAndLeviesExpense: Number(summary?.rates_and_levies_expense ?? 0),
    ratesTaxesExpense: Number(summary?.rates_taxes_expense ?? 0),
    leviesExpense: Number(summary?.levies_expense ?? 0),
    otherExpenses: Number(summary?.other_expenses ?? 0),
    totalExpenses,
    budgetPlanned,
    budgetUsedPercent,
    budgetRemaining,
    netOperatingPosition: rentCollected - totalExpenses,
    awaitingConfirmationCount: Number(summary?.awaiting_confirmation_count ?? 0),
    budgetAlerts: budgetAlertsFor(propertyId, month, budgetUsedPercent),
    utilityAnomalyAlerts: [],
  };
}

/** Portfolio-wide (no property filter): owner_portfolio_financial_summary() -- the org-wide
 *  counterpart GET /api/v1/organizations/:orgId/financial-summary wraps. */
export async function loadPortfolioFinancialOverview(
  supabase: SupabaseClient,
  orgId: string,
  month: string,
): Promise<OwnerFinancialSummary | null> {
  const { data, error } = await supabase
    .rpc('owner_portfolio_financial_summary', { p_org_id: orgId, p_month: month })
    .maybeSingle();
  if (error) return null;

  const row = data as PortfolioSummaryRow | null;
  const rentCollected = Number(row?.rent_collected ?? 0);
  const totalExpenses = Number(row?.total_expenses ?? 0);
  const budgetPlanned = Number(row?.budget_planned ?? 0);
  const budgetUsedPercent =
    row?.budget_used_percent === null || row?.budget_used_percent === undefined
      ? null
      : Number(row.budget_used_percent);
  const budgetRemaining = Number(row?.budget_remaining ?? 0);

  return {
    propertyId: null,
    propertyCount: Number(row?.property_count ?? 0),
    month,
    rentPlanned: Number(row?.rent_planned ?? 0),
    rentCollected,
    rentOutstanding: Number(row?.rent_outstanding ?? 0),
    utilitiesExpense: Number(row?.utilities_expense ?? 0),
    waterExpense: Number(row?.water_expense ?? 0),
    electricityExpense: Number(row?.electricity_expense ?? 0),
    ratesAndLeviesExpense: Number(row?.rates_and_levies_expense ?? 0),
    ratesTaxesExpense: Number(row?.rates_taxes_expense ?? 0),
    leviesExpense: Number(row?.levies_expense ?? 0),
    otherExpenses: Number(row?.other_expenses ?? 0),
    totalExpenses,
    budgetPlanned: budgetPlanned || null,
    budgetUsedPercent,
    budgetRemaining: budgetPlanned ? budgetRemaining : null,
    netOperatingPosition: rentCollected - totalExpenses,
    awaitingConfirmationCount: Number(row?.awaiting_confirmation_count ?? 0),
    budgetAlerts: budgetAlertsFor(orgId, month, budgetUsedPercent),
    utilityAnomalyAlerts: [],
  };
}
