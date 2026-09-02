import { NextResponse, type NextRequest } from 'next/server';
import { monthlyBudgetSetSchema } from '@propvault/validation';
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
 * GET/POST /api/v1/properties/:id/budget?month=YYYY-MM-01 -- V1 property budgeting pass
 * (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §2/§3, migration 20260101000164). GET returns
 * server-authoritative budget-vs-actual for one month (budget_vs_actual() RPC -- actual is always
 * summed from `expenses`, never independently recomputed here). POST sets/updates that month's
 * planned amount (set_monthly_budget() RPC, upsert).
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

  const { data, error } = await supabase
    .rpc('budget_vs_actual', { p_property_id: id, p_month: month })
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'budget_vs_actual_failed',
          message: safeErrorMessage(error, 'Could not load budget vs actual.', 'budget_vs_actual'),
        },
      },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json({
      budgetVsActual: {
        budgetId: null,
        plannedAmount: null,
        actualAmount: 0,
        remainingAmount: null,
        varianceAmount: null,
        percentUsed: null,
      } satisfies BudgetVsActual,
    });
  }

  return NextResponse.json({ budgetVsActual: mapRow(data as BudgetVsActualRow) });
}

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

  const parsed = monthlyBudgetSetSchema.safeParse({ ...(body as object), propertyId: id });
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

  const { data, error } = await supabase.rpc('set_monthly_budget', {
    p_org_id: parsed.data.orgId,
    p_property_id: parsed.data.propertyId,
    p_month: parsed.data.month,
    p_planned_amount: parsed.data.plannedAmount,
  });

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'budget_set_failed',
          message: safeErrorMessage(
            error,
            'Could not set this budget. Please try again, or contact support if this continues.',
            'property_budgets.set',
          ),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ budgetId: data }, { status: 201 });
}
