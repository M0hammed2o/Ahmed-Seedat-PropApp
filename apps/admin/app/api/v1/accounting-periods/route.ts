import { NextResponse, type NextRequest } from 'next/server';
import { accountingPeriodCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapAccountingPeriodRow } from '@/lib/accounting';

/**
 * GET/POST /api/v1/accounting-periods (ACCOUNTING.md §9). V1 period management is manual --
 * staff explicitly create and close periods, no automatic period generation.
 */
export async function GET(request: NextRequest) {
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

  const url = new URL(request.url);
  const orgIdFilter = url.searchParams.get('filter[org_id]');
  const statusFilter = url.searchParams.get('filter[status]');

  let query = supabase
    .from('accounting_periods')
    .select('*')
    .order('period_start', { ascending: false });

  if (orgIdFilter) query = query.eq('org_id', orgIdFilter);
  if (statusFilter) query = query.eq('status', statusFilter);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: 'accounting_periods_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ accountingPeriods: (data ?? []).map(mapAccountingPeriodRow) });
}

export async function POST(request: NextRequest) {
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

  const parsed = accountingPeriodCreateSchema.safeParse(body);
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
          message: 'You do not have permission to create accounting periods for this organization.',
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('accounting_periods')
    .insert({
      org_id: parsed.data.orgId,
      period_start: parsed.data.periodStart,
      period_end: parsed.data.periodEnd,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'accounting_period_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ accountingPeriod: mapAccountingPeriodRow(data) }, { status: 201 });
}
