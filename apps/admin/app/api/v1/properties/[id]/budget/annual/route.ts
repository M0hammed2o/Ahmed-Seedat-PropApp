import { NextResponse, type NextRequest } from 'next/server';
import { annualBudgetDistributeSchema } from '@propvault/validation';
import type { BudgetVsActual } from '@propvault/types';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

interface BudgetVsActualRow {
  budget_id: string | null;
  planned_amount: string | null;
  actual_amount: string;
  remaining_amount: string | null;
  variance_amount: string | null;
  percent_used: string | null;
}

function mapRow(row: BudgetVsActualRow): BudgetVsActual {
  return {
    budgetId: row.budget_id,
    plannedAmount: row.planned_amount === null ? null : Number(row.planned_amount),
    actualAmount: Number(row.actual_amount),
    remainingAmount: row.remaining_amount === null ? null : Number(row.remaining_amount),
    varianceAmount: row.variance_amount === null ? null : Number(row.variance_amount),
    percentUsed: row.percent_used === null ? null : Number(row.percent_used),
  };
}

/**
 * GET /api/v1/properties/:id/budget/annual?year=YYYY -- property/unit financial setup pass
 * (WORKLOG.md this date), §7's "avoid firing 12 individual month requests" audit. The Annual
 * budget panel previously called GET /budget?month=X once per month client-side (12 round trips
 * per page load). This batches the exact same budget_vs_actual() RPC server-side instead -- one
 * HTTP request, the RPC still runs once per month (no new aggregate query, no risk of drifting from
 * the single-month route's own actual/variance computation) -- and returns all 12 months in one
 * response. Not a new budgeting backend: same RPC, same authorization, just fewer round trips.
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
    months.map((month) => supabase.rpc('budget_vs_actual', { p_property_id: id, p_month: month }).maybeSingle()),
  );

  const firstError = results.find((r) => r.error)?.error;
  if (firstError) {
    return NextResponse.json(
      {
        error: {
          code: 'budget_vs_actual_failed',
          message: safeErrorMessage(firstError, 'Could not load the annual budget.', 'budget_vs_actual'),
        },
      },
      { status: 500 },
    );
  }

  const monthsOut = months.map((month, i) => ({
    month,
    budgetVsActual: results[i]!.data
      ? mapRow(results[i]!.data as BudgetVsActualRow)
      : ({
          budgetId: null,
          plannedAmount: null,
          actualAmount: 0,
          remainingAmount: null,
          varianceAmount: null,
          percentUsed: null,
        } satisfies BudgetVsActual),
  }));

  return NextResponse.json({ months: monthsOut });
}

/**
 * POST /api/v1/properties/:id/budget/annual -- §2's "create annual budget and distribute evenly
 * across months" convenience workflow. Thin wrapper over distribute_annual_budget() -- produces 12
 * ordinary, independently-editable property_budgets rows (via /budget's own POST afterward); no
 * separate annual total is stored anywhere.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = annualBudgetDistributeSchema.safeParse({ ...(body as object), propertyId: id });
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          field_errors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const canWrite = await requireOrgRole(supabase, parsed.data.orgId, 'accountant');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to set a budget for this organization.',
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase.rpc('distribute_annual_budget', {
    p_org_id: parsed.data.orgId,
    p_property_id: parsed.data.propertyId,
    p_year: parsed.data.year,
    p_annual_total: parsed.data.annualTotal,
  });

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'annual_budget_distribute_failed',
          message: safeErrorMessage(
            error,
            'Could not create the annual budget. Please try again, or contact support if this continues.',
            'property_budgets.distribute_annual',
          ),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ budgetIds: data ?? [] }, { status: 201 });
}
