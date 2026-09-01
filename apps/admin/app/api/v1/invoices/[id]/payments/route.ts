import { NextResponse, type NextRequest } from 'next/server';
import { invoicePaymentCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapInvoicePaymentRow } from '@/lib/accounting';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET/POST /api/v1/invoices/:id/payments -- the one payment-recording path for BOTH manual and
 * rent-sourced invoices (unified invoice-payment ledger, migration 20260101000158). Overpayment is
 * never permitted -- record_invoice_payment() has no bypass parameter at all, not just a hidden
 * one; this route's own pre-flight check exists purely to surface a friendlier structured error
 * before the RPC's own authoritative check runs.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
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

  const { data, error } = await supabase
    .from('invoice_payments')
    .select('*')
    .eq('invoice_id', id)
    .order('paid_at', { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: { code: 'invoice_payments_fetch_failed', message: safeErrorMessage(error, 'Could not load payments for this invoice.', 'invoices/[id]/payments.list') } },
      { status: 500 },
    );
  }

  return NextResponse.json({ payments: (data ?? []).map(mapInvoicePaymentRow) });
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

  const { data: existing, error: fetchError } = await supabase
    .from('invoices')
    .select('org_id, amount')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'invoice_fetch_failed', message: safeErrorMessage(fetchError, 'Could not load this invoice.', 'invoices/[id]/payments.fetch') } },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Invoice not found.' } }, { status: 404 });
  }

  const canWrite = await requireOrgRole(supabase, existing.org_id, 'accountant');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to record payments for this organization.' } },
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

  const parsed = invoicePaymentCreateSchema.safeParse(body);
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

  // Overpayment is never permitted -- record_invoice_payment() itself refuses it unconditionally
  // (migration 158, no bypass parameter exists). This pre-flight only exists so the client gets a
  // structured, actionable "this would overpay by R<x>" 409 instead of a generic 400 -- the RPC's
  // own check is still the real, authoritative enforcement.
  const { data: existingPayments, error: paymentsError } = await supabase
    .from('invoice_payments')
    .select('amount')
    .eq('invoice_id', id)
    .is('reversed_at', null);
  if (paymentsError) {
    return NextResponse.json(
      { error: { code: 'invoice_payments_fetch_failed', message: safeErrorMessage(paymentsError, 'Could not load existing payments for this invoice.', 'invoices/[id]/payments.precheck') } },
      { status: 500 },
    );
  }
  const alreadyPaid = (existingPayments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
  const wouldOverpayBy = alreadyPaid + parsed.data.amount - Number(existing.amount);
  if (wouldOverpayBy > 0) {
    return NextResponse.json(
      {
        error: {
          code: 'would_overpay',
          message: `This payment would overpay the invoice by R${wouldOverpayBy.toFixed(2)}. Overpayment is not supported -- record a smaller amount or reverse an existing payment first.`,
          already_paid: alreadyPaid,
          invoice_amount: Number(existing.amount),
          would_overpay_by: wouldOverpayBy,
        },
      },
      { status: 409 },
    );
  }

  const { data: paymentId, error: rpcError } = await supabase.rpc('record_invoice_payment', {
    p_invoice_id: id,
    p_amount: parsed.data.amount,
    p_paid_at: parsed.data.paidAt,
    p_method: parsed.data.method,
    p_reference: parsed.data.reference ?? null,
    p_notes: parsed.data.notes ?? null,
    p_bank_transaction_id: parsed.data.bankTransactionId ?? null,
  });
  if (rpcError) {
    return NextResponse.json(
      {
        error: {
          code: 'invoice_payment_failed',
          message: safeErrorMessage(rpcError, 'Could not record this payment.', 'invoices/[id]/payments.create'),
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
      { error: { code: 'invoice_payment_fetch_failed', message: 'Payment was recorded, but could not be reloaded. Please refresh.' } },
      { status: 500 },
    );
  }

  return NextResponse.json({ payment: mapInvoicePaymentRow(payment) }, { status: 201 });
}
