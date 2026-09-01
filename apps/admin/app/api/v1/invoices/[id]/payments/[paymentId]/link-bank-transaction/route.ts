import { NextResponse, type NextRequest } from 'next/server';
import { invoicePaymentLinkBankTransactionSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapInvoicePaymentRow } from '@/lib/accounting';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string; paymentId: string }> };

/**
 * POST /api/v1/invoices/:id/payments/:paymentId/link-bank-transaction --
 * link_bank_transaction_to_invoice_payment() (migration 20260101000158). Ties a bank transaction
 * imported AFTER the payment was already recorded manually to the EXISTING payment row, instead of
 * risking a second payment entry for the same real money. Purely evidentiary -- never posts a
 * second journal entry; record_invoice_payment() already posted the real GL impact when the
 * payment was first recorded.
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
      { error: { code: 'invoice_payment_fetch_failed', message: safeErrorMessage(fetchError, 'Could not load this payment.', 'invoices/[id]/payments/[paymentId]/link-bank-transaction.fetch') } },
      { status: 500 },
    );
  }
  if (!existing || existing.invoice_id !== id) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Payment not found.' } }, { status: 404 });
  }

  const canWrite = await requireOrgRole(supabase, existing.org_id, 'accountant');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to link bank transactions for this organization.' } },
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

  const parsed = invoicePaymentLinkBankTransactionSchema.safeParse(body);
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

  const { error: rpcError } = await supabase.rpc('link_bank_transaction_to_invoice_payment', {
    p_invoice_payment_id: paymentId,
    p_bank_transaction_id: parsed.data.bankTransactionId,
  });
  if (rpcError) {
    return NextResponse.json(
      {
        error: {
          code: 'invoice_payment_link_failed',
          message: safeErrorMessage(rpcError, 'Could not link this bank transaction.', 'invoices/[id]/payments/[paymentId]/link-bank-transaction'),
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
      { error: { code: 'invoice_payment_fetch_failed', message: 'Bank transaction was linked, but the payment could not be reloaded. Please refresh.' } },
      { status: 500 },
    );
  }

  return NextResponse.json({ payment: mapInvoicePaymentRow(payment) });
}
