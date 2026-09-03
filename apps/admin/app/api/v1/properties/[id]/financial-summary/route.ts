import { NextResponse, type NextRequest } from 'next/server';
import type { BudgetAlert, OwnerFinancialSummary } from '@propvault/types';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

interface SummaryRow {
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

interface BudgetVsActualRow {
  budget_id: string | null;
  planned_amount: string | null;
  actual_amount: string;
  remaining_amount: string | null;
  variance_amount: string | null;
  percent_used: string | null;
}

// §4A: 80% is the documented V1 default threshold -- no per-org configuration exists yet
// (deliberately deferred, see UTILITIES_RATES_BUDGET_IMPLEMENTATION.md).
const BUDGET_APPROACHING_THRESHOLD_PERCENT = 80;

/**
 * GET /api/v1/properties/:id/financial-summary?month=YYYY-MM-01 -- UTILITIES_RATES_BUDGET_GAP_AUDIT.md
 * §6/§8, migrations 20260101000164/166. The single owner-facing financial dashboard endpoint --
 * Android Home and the web Reports page both call this instead of composing the same figures from
 * several independent queries (§16's explicit "avoid N+1" rule). Utility anomaly alerts are
 * intentionally NOT included here -- they are per-meter, not per-property, and are served by each
 * meter's own /api/v1/utility-meters/:id/readings history (isUnusualUsage) to avoid this endpoint
 * having to scan every meter on every Home-screen load.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  const month = request.nextUrl.searchParams.get('month');
  if (!month) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'A ?month=YYYY-MM-01 query parameter is required.' } },
      { status: 400 },
    );
  }

  const [summaryResult, budgetResult] = await Promise.all([
    supabase.rpc('owner_financial_summary', { p_property_id: id, p_month: month }).maybeSingle(),
    supabase.rpc('budget_vs_actual', { p_property_id: id, p_month: month }).maybeSingle(),
  ]);

  if (summaryResult.error) {
    return NextResponse.json(
      {
        error: {
          code: 'financial_summary_failed',
          message: safeErrorMessage(summaryResult.error, 'Could not load the financial summary.', 'owner_financial_summary'),
        },
      },
      { status: summaryResult.error.message.includes('does not have access') ? 403 : 500 },
    );
  }

  const summary = summaryResult.data as SummaryRow | null;
  const budget = budgetResult.data as BudgetVsActualRow | null;

  const rentPlanned = Number(summary?.rent_planned ?? 0);
  const rentCollected = Number(summary?.rent_collected ?? 0);
  const rentOutstanding = Number(summary?.rent_outstanding ?? 0);
  const utilitiesExpense = Number(summary?.utilities_expense ?? 0);
  const waterExpense = Number(summary?.water_expense ?? 0);
  const electricityExpense = Number(summary?.electricity_expense ?? 0);
  const ratesAndLeviesExpense = Number(summary?.rates_and_levies_expense ?? 0);
  const ratesTaxesExpense = Number(summary?.rates_taxes_expense ?? 0);
  const leviesExpense = Number(summary?.levies_expense ?? 0);
  const otherExpenses = Number(summary?.other_expenses ?? 0);
  const totalExpenses = Number(summary?.total_expenses ?? 0);

  const budgetPlanned = budget?.planned_amount === null || budget?.planned_amount === undefined ? null : Number(budget.planned_amount);
  const budgetUsedPercent = budget?.percent_used === null || budget?.percent_used === undefined ? null : Number(budget.percent_used);
  const budgetRemaining = budget?.remaining_amount === null || budget?.remaining_amount === undefined ? null : Number(budget.remaining_amount);

  const budgetAlerts: BudgetAlert[] = [];
  if (budgetUsedPercent !== null) {
    if (budgetUsedPercent >= 100) {
      budgetAlerts.push({ propertyId: id, month, level: 'exceeded', percentUsed: budgetUsedPercent });
    } else if (budgetUsedPercent >= BUDGET_APPROACHING_THRESHOLD_PERCENT) {
      budgetAlerts.push({ propertyId: id, month, level: 'approaching', percentUsed: budgetUsedPercent });
    }
  }

  const result: OwnerFinancialSummary = {
    propertyId: id,
    month,
    rentPlanned,
    rentCollected,
    rentOutstanding,
    utilitiesExpense,
    waterExpense,
    electricityExpense,
    ratesAndLeviesExpense,
    ratesTaxesExpense,
    leviesExpense,
    otherExpenses,
    totalExpenses,
    budgetPlanned,
    budgetUsedPercent,
    budgetRemaining,
    // "Monthly net position" (see this endpoint's own doc comment + UTILITIES_RATES_BUDGET_IMPLEMENTATION.md):
    // rent collected minus owner expenses ONLY -- never labelled "profit" (excludes tax, finance
    // costs, depreciation, management fee).
    netOperatingPosition: rentCollected - totalExpenses,
    awaitingConfirmationCount: Number(summary?.awaiting_confirmation_count ?? 0),
    budgetAlerts,
    utilityAnomalyAlerts: [],
  };

  return NextResponse.json({ financialSummary: result });
}
