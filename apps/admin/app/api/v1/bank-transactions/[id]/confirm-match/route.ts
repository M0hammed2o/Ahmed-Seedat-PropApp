import { NextResponse, type NextRequest } from 'next/server';
import { bankTransactionConfirmMatchSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapBankTransactionRow } from '@/lib/accounting';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/bank-transactions/:id/confirm-match (API_SPEC.md §6). Thin wrapper over
 * confirm_bank_transaction_match() (migration 20260101000038) -- the rent-payment case only
 * (matches a bank transaction to a rent_schedule). Confirmation is always an explicit staff
 * action (ACCOUNTING.md §8: "never auto-confirms") -- there is no separate "propose" step in
 * this V1 implementation (the evidenced `calculateMatchScore` proposal step for rent payments is
 * not yet wired in here; the caller currently supplies which rent_schedule to match against
 * directly).
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

  const parsed = bankTransactionConfirmMatchSchema.safeParse(body);
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

  const { error: matchError } = await supabase.rpc('confirm_bank_transaction_match', {
    p_bank_transaction_id: id,
    p_rent_schedule_id: parsed.data.rentScheduleId,
  });

  if (matchError) {
    return NextResponse.json(
      { error: { code: 'confirm_match_failed', message: matchError.message } },
      { status: 500 },
    );
  }

  const { data, error: fetchError } = await supabase
    .from('bank_transactions')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'bank_transaction_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ bankTransaction: mapBankTransactionRow(data) });
}
