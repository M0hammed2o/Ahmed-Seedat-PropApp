import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapAccountingPeriodRow } from '@/lib/accounting';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/accounting-periods/:id/reopen (ACCOUNTING.md §9). Thin wrapper over
 * reopen_accounting_period(). Note: ACCOUNTING.md §9 says reopening "writes an audit_events row" --
 * not done here, because audit_events' live actor_type enum has no value correctly describing an
 * org accountant (vs. a platform admin or the system) -- see the migration's own comment and
 * TECHNICAL_DEBT_REGISTER.md TD-14. Writing a semantically-wrong row would misrepresent who
 * reopened the period, not just omit metadata.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
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

  const { error } = await supabase.rpc('reopen_accounting_period', { p_period_id: id });
  if (error) {
    return NextResponse.json(
      { error: { code: 'reopen_period_failed', message: error.message } },
      { status: error.message.includes('not found') ? 404 : 500 },
    );
  }

  const { data, error: fetchError } = await supabase
    .from('accounting_periods')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'accounting_period_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ accountingPeriod: mapAccountingPeriodRow(data) });
}
