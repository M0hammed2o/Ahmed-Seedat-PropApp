import { NextResponse, type NextRequest } from 'next/server';
import { cashReceiptConfirmDepositSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapCashReceiptRow } from '@/lib/accounting';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/cash-receipts/:id/confirm-deposit (Stage 3 Phase 7, commercial-launch execution
 * plan). Thin wrapper over confirm_cash_receipt_deposit() (migration 20260101000073) -- posts the
 * Dr Bank/Cr Accounts Receivable entry for the deposited amount and records the variance against
 * what was originally received.
 */
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

  const parsed = cashReceiptConfirmDepositSchema.safeParse(body);
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

  const { error: confirmError } = await supabase.rpc('confirm_cash_receipt_deposit', {
    p_cash_receipt_id: id,
    p_bank_transaction_id: parsed.data.bankTransactionId,
    p_deposited_amount: parsed.data.depositedAmount,
  });
  if (confirmError) {
    return NextResponse.json(
      { error: { code: 'cash_receipt_confirm_failed', message: confirmError.message } },
      { status: 422 },
    );
  }

  const { data, error } = await supabase.from('cash_receipts').select('*').eq('id', id).single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'cash_receipt_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ cashReceipt: mapCashReceiptRow(data) });
}
