import { NextResponse, type NextRequest } from 'next/server';
import { invoicePaymentCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapInvoicePaymentRow } from '@/lib/accounting';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET/POST /api/v1/invoices/:id/payments -- manual "this invoice was paid" evidence
 * (invoice_payments, migration 20260101000152). Deliberately separate from
 * bank_transactions/cash_receipts reconciliation -- rent invoices keep using that mechanism
 * exactly as before; this is only for manual (non-rent) invoices, and record_invoice_payment()
 * itself refuses a draft invoice, so there's nothing to guard against here beyond org role.
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

  // Final accounting reconciliation pass: computed here (not just left to the RPC's own guard,
  // migration 157) so the client gets a structured, actionable "this would overpay by R<x>" 409
  // instead of a swallowed generic 500 -- record_invoice_payment()'s own check is still the real,
  // authoritative enforcement (defense in depth, same pattern as the archived-resource visibility
  // checks elsewhere in this app), this is purely a friendlier pre-flight.
  if (!parsed.data.allowOverpayment) {
    const { data: existingPayments, error: paymentsError } = await supabase
      .from('invoice_payments')
      .select('amount')
      .eq('invoice_id', id);
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
            message: `This payment would overpay the invoice by R${wouldOverpayBy.toFixed(2)}. Confirm to record it as an overpayment anyway.`,
            already_paid: alreadyPaid,
            invoice_amount: Number(existing.amount),
            would_overpay_by: wouldOverpayBy,
          },
        },
        { status: 409 },
      );
    }
  }

  const { data: paymentId, error: rpcError } = await supabase.rpc('record_invoice_payment', {
    p_invoice_id: id,
    p_amount: parsed.data.amount,
    p_paid_at: parsed.data.paidAt,
    p_method: parsed.data.method ?? null,
    p_notes: parsed.data.notes ?? null,
    p_bank_transaction_id: parsed.data.bankTransactionId ?? null,
    p_allow_overpayment: parsed.data.allowOverpayment ?? false,
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
