import { NextResponse, type NextRequest } from 'next/server';
import { invoicePaymentReversalSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapInvoicePaymentRow } from '@/lib/accounting';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string; paymentId: string }> };

/**
 * POST /api/v1/invoices/:id/payments/:paymentId/reverse -- reverse_invoice_payment() (migration
 * 20260101000158). Never deletes or edits the original payment row beyond its reversal columns;
 * posts a mirror-image correcting journal entry; releases any linked bank transaction back to
 * unmatched; recomputes the invoice's paid/balance/status and, for a rent-sourced invoice, the
 * linked rent_schedule's status too.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id, paymentId } = await params;
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

  const { data: existing, error: fetchError } = await supabase
    .from('invoice_payments')
    .select('org_id, invoice_id')
    .eq('id', paymentId)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'invoice_payment_fetch_failed', message: safeErrorMessage(fetchError, 'Could not load this payment.', 'invoices/[id]/payments/[paymentId]/reverse.fetch') } },
      { status: 500 },
    );
  }
  if (!existing || existing.invoice_id !== id) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Payment not found.' } }, { status: 404 });
  }

  const canWrite = await requireOrgRole(supabase, existing.org_id, 'accountant');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to reverse payments for this organization.' } },
      { status: 403 },
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

  const parsed = invoicePaymentReversalSchema.safeParse(body);
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

  const { error: rpcError } = await supabase.rpc('reverse_invoice_payment', {
    p_payment_id: paymentId,
    p_reason: parsed.data.reason,
  });
  if (rpcError) {
    return NextResponse.json(
      {
        error: {
          code: 'invoice_payment_reversal_failed',
          message: safeErrorMessage(rpcError, 'Could not reverse this payment.', 'invoices/[id]/payments/[paymentId]/reverse'),
        },
      },
      { status: 400 },
    );
  }

  const { data: payment, error: reloadError } = await supabase
    .from('invoice_payments')
    .select('*')
    .eq('id', paymentId)
    .single();
  if (reloadError) {
    return NextResponse.json(
      { error: { code: 'invoice_payment_fetch_failed', message: 'Payment was reversed, but could not be reloaded. Please refresh.' } },
      { status: 500 },
    );
  }

  return NextResponse.json({ payment: mapInvoicePaymentRow(payment) });
}
