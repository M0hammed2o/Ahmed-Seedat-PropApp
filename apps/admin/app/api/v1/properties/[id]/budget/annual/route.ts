import { NextResponse, type NextRequest } from 'next/server';
import { annualBudgetDistributeSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

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
