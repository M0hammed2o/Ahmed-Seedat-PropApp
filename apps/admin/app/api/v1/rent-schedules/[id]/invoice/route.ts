import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapInvoiceRow } from '@/lib/accounting';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/rent-schedules/:id/invoice -- thin wrapper over invoice_rent_schedule()
 * (migration 20260101000038). Pragmatic route naming: API_SPEC.md §6 lists invoice creation
 * under `POST /api/v1/invoices` and issuance under `POST /api/v1/invoices/:id/issue` as two
 * steps; invoice_rent_schedule() creates an already-issued invoice from a pending rent schedule
 * in one step, so this route is named for what it actually does rather than force-fitting it
 * into the two-step shape.
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

  const { data: invoiceId, error: invoiceError } = await supabase.rpc('invoice_rent_schedule', {
    p_rent_schedule_id: id,
  });

  if (invoiceError) {
    return NextResponse.json(
      { error: { code: 'invoice_failed', message: invoiceError.message } },
      { status: 500 },
    );
  }

  const { data, error: fetchError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .single();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'invoice_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ invoice: mapInvoiceRow(data) }, { status: 201 });
}
