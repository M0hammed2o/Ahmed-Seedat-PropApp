import { NextResponse, type NextRequest } from 'next/server';
import { recurringCostSetSchema } from '@propvault/validation';
import type { RecurringPropertyCost } from '@propvault/types';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

interface RecurringPropertyCostRow {
  id: string;
  org_id: string;
  property_id: string;
  unit_id: string | null;
  cost_type: 'rates_and_taxes' | 'levy';
  amount: string;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: RecurringPropertyCostRow): RecurringPropertyCost {
  return {
    id: row.id,
    orgId: row.org_id,
    propertyId: row.property_id,
    unitId: row.unit_id,
    costType: row.cost_type,
    amount: Number(row.amount),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET/POST /api/v1/properties/:id/recurring-costs -- V1 utilities/rates/levies pass
 * (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §1A/§1B, migration 20260101000163). GET returns the full
 * effective-dated history (current + superseded rows) for this property, optionally filtered to
 * one unit via ?unitId=; the current row for each (scope, cost_type) is the one with
 * effective_to = null. POST is a thin wrapper over set_recurring_property_cost() -- the RPC is the
 * only writer (closes out the previous current row itself), never a raw insert here.
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

  const unitId = request.nextUrl.searchParams.get('unitId');
  let query = supabase
    .from('recurring_property_costs')
    .select('*')
    .eq('property_id', id)
    .order('cost_type', { ascending: true })
    .order('effective_from', { ascending: false });
  if (unitId) query = query.eq('unit_id', unitId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'recurring_costs_list_failed',
          message: safeErrorMessage(error, 'Could not load rates/levy history.', 'recurring_property_costs.list'),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ recurringCosts: (data ?? []).map(mapRow) });
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

  const parsed = recurringCostSetSchema.safeParse({ ...(body as object), propertyId: id });
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
          message: 'You do not have permission to set rates/levies for this organization.',
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase.rpc('set_recurring_property_cost', {
    p_org_id: parsed.data.orgId,
    p_property_id: parsed.data.propertyId,
    p_unit_id: parsed.data.unitId ?? null,
    p_cost_type: parsed.data.costType,
    p_amount: parsed.data.amount,
    p_effective_from: parsed.data.effectiveFrom,
    p_notes: parsed.data.notes ?? null,
  });

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'recurring_cost_set_failed',
          message: safeErrorMessage(
            error,
            'Could not set this rates/levy amount. Please try again, or contact support if this continues.',
            'recurring_property_costs.set',
          ),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ recurringCostId: data ?? null }, { status: 201 });
}
