import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/safeError';
import { summarizeAnnualBudget } from '@/lib/annualBudgetSummary';

type RouteParams = { params: Promise<{ orgId: string }> };

interface PortfolioSummaryRow {
  budget_planned: string;
  budget_actual: string;
}

/**
 * GET /api/v1/organizations/:orgId/budget/annual?year=YYYY -- Phase A budget-hierarchy pass
 * (WORKLOG.md this date). "Annual portfolio budget = sum of all property annual budgets" was true
 * at the monthly level (owner_portfolio_financial_summary() already sums property_budgets.
 * planned_amount across the org's properties for one month) but had no year-wide counterpart --
 * Android and web would otherwise each be tempted to sum 12 months client-side, which is exactly
 * the "duplicate budget truth" this pass forbids. Mirrors the property-level GET .../budget/annual
 * added earlier this same day: batches owner_portfolio_financial_summary() once per month
 * server-side (same RPC the monthly portfolio card already uses, migration 167), then sums the 12
 * already-authoritative months into one annual rollup in this handler -- never a new aggregate
 * query, never computed on-device.
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

  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : NaN;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'A valid ?year=YYYY query parameter is required.' } },
      { status: 400 },
    );
  }

  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`);
  const results = await Promise.all(
    months.map((month) =>
      supabase.rpc('owner_portfolio_financial_summary', { p_org_id: orgId, p_month: month }).maybeSingle(),
    ),
  );

  const firstError = results.find((r) => r.error)?.error;
  if (firstError) {
    const forbidden = firstError.message.includes('does not have access');
    return NextResponse.json(
      {
        error: {
          code: 'portfolio_annual_budget_failed',
          message: forbidden
            ? "You do not have permission to view this organization's budget."
            : safeErrorMessage(firstError, 'Could not load the annual portfolio budget.', 'owner_portfolio_financial_summary'),
        },
      },
      { status: forbidden ? 403 : 500 },
    );
  }

  const monthsOut = months.map((month, i) => {
    const row = results[i]!.data as PortfolioSummaryRow | null;
    const plannedAmount = row?.budget_planned == null ? null : Number(row.budget_planned);
    return {
      month,
      plannedAmount: plannedAmount || null,
      actualAmount: Number(row?.budget_actual ?? 0),
    };
  });

  const annual = summarizeAnnualBudget(year, monthsOut);

  return NextResponse.json({ months: monthsOut, annual });
}
