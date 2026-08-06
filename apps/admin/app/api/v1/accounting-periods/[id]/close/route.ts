import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapAccountingPeriodRow } from '@/lib/accounting';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/accounting-periods/:id/close (ACCOUNTING.md §9). Thin wrapper over close_accounting_period(). */
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

  const { error } = await supabase.rpc('close_accounting_period', { p_period_id: id });
  if (error) {
    return NextResponse.json(
      { error: { code: 'close_period_failed', message: error.message } },
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
