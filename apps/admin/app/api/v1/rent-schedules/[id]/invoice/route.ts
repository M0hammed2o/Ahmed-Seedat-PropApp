import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapInvoiceRow } from '@/lib/accounting';
import { safeErrorMessage } from '@/lib/safeError';

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
      {
        error: {
          code: 'invoice_failed',
          message: safeErrorMessage(
            invoiceError,
            'Could not create an invoice for this rent schedule. Please try again, or contact support if this continues.',
            `invoice_rent_schedule(${id})`,
          ),
        },
      },
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
      {
        error: {
          code: 'invoice_fetch_failed',
          message: safeErrorMessage(
            fetchError,
            'The invoice was created, but could not be loaded. Please refresh, or contact support if this continues.',
            `invoices.fetch(${invoiceId})`,
          ),
        },
      },
      { status: 500 },
    );
  }

  // Property/unit lifecycle + invoicing pass (WORKLOG.md this date): this route used to
  // automatically email the tenant on every issuance, with no landlord choice and no opt-out --
  // now that internal (no-portal, no-email) tenants are a first-class product mode, "creating an
  // invoice" and "sending an invoice to the tenant" must be two distinct, separately-triggered
  // actions (see POST /api/v1/invoices/:id/send). Issuing an invoice here never contacts the
  // tenant by itself.
  return NextResponse.json({ invoice: mapInvoiceRow(data) }, { status: 201 });
}
