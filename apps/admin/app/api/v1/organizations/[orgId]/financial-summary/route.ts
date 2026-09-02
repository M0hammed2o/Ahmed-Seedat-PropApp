import { NextResponse, type NextRequest } from 'next/server';
import type { BudgetAlert, OwnerFinancialSummary } from '@propvault/types';
import { getServerSupabaseClient } from '@/lib/supabase/server';

type RouteParams = { params: Promise<{ orgId: string }> };

interface PortfolioSummaryRow {
  rent_planned: string;
  rent_collected: string;
  rent_outstanding: string;
  utilities_expense: string;
  rates_and_levies_expense: string;
  other_expenses: string;
  total_expenses: string;
  budget_planned: string;
  budget_actual: string;
  budget_remaining: string;
  budget_used_percent: string | null;
  net_operating_position: string;
  awaiting_confirmation_count: number;
  property_count: number;
}

const BUDGET_APPROACHING_THRESHOLD_PERCENT = 80;

/**
 * GET /api/v1/organizations/:orgId/financial-summary?month=YYYY-MM-01 -- continuation pass
 * (UTILITIES_RATES_BUDGET_IMPLEMENTATION.md "Portfolio-wide owner financial summary"). Thin
 * wrapper over owner_portfolio_financial_summary() (migration 167) -- the LIVE, portfolio-wide
 * counterpart of /api/v1/properties/:id/financial-summary. This is what Android Home and any
 * future portfolio-wide web view should call; the per-property endpoint remains for the property
 * detail page's own Finances tab.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { orgId } = await params;
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

  const { data, error } = await supabase
    .rpc('owner_portfolio_financial_summary', { p_org_id: orgId, p_month: month })
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'portfolio_financial_summary_failed',
          message: error.message.includes('does not have access')
            ? "You do not have permission to view this organization's financial summary."
            : 'Could not load the portfolio financial summary.',
        },
      },
      { status: error.message.includes('does not have access') ? 403 : 500 },
    );
  }

  const row = data as PortfolioSummaryRow | null;
  const rentCollected = Number(row?.rent_collected ?? 0);
  const totalExpenses = Number(row?.total_expenses ?? 0);
  const budgetPlanned = Number(row?.budget_planned ?? 0);
  const budgetUsedPercent = row?.budget_used_percent === null || row?.budget_used_percent === undefined
    ? null
    : Number(row.budget_used_percent);
  const budgetRemaining = Number(row?.budget_remaining ?? 0);

  const budgetAlerts: BudgetAlert[] = [];
  if (budgetUsedPercent !== null) {
    if (budgetUsedPercent >= 100) {
      budgetAlerts.push({ propertyId: orgId, month, level: 'exceeded', percentUsed: budgetUsedPercent });
    } else if (budgetUsedPercent >= BUDGET_APPROACHING_THRESHOLD_PERCENT) {
      budgetAlerts.push({ propertyId: orgId, month, level: 'approaching', percentUsed: budgetUsedPercent });
    }
  }

  const result: OwnerFinancialSummary = {
    propertyId: null,
    propertyCount: Number(row?.property_count ?? 0),
    month,
    rentPlanned: Number(row?.rent_planned ?? 0),
    rentCollected,
    rentOutstanding: Number(row?.rent_outstanding ?? 0),
    utilitiesExpense: Number(row?.utilities_expense ?? 0),
    ratesAndLeviesExpense: Number(row?.rates_and_levies_expense ?? 0),
    otherExpenses: Number(row?.other_expenses ?? 0),
    totalExpenses,
    budgetPlanned: budgetPlanned || null,
    budgetUsedPercent,
    budgetRemaining: budgetPlanned ? budgetRemaining : null,
    netOperatingPosition: rentCollected - totalExpenses,
    awaitingConfirmationCount: Number(row?.awaiting_confirmation_count ?? 0),
    budgetAlerts,
    utilityAnomalyAlerts: [],
  };

  return NextResponse.json({ financialSummary: result });
}
