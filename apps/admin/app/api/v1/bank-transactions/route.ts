import { NextResponse, type NextRequest } from 'next/server';
import { bankTransactionCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapBankTransactionRow } from '@/lib/accounting';
import { safeErrorMessage } from '@/lib/safeError';

/**
 * GET/POST /api/v1/bank-transactions (API_SPEC.md §6). POST here is plain transaction entry
 * (e.g. from a statement import) -- matching happens separately via
 * POST /api/v1/bank-transactions/:id/confirm-match, never automatically at creation.
 */
export async function GET(request: NextRequest) {
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

  const url = new URL(request.url);
  const bankAccountId = url.searchParams.get('filter[bank_account_id]');
  const matchStatus = url.searchParams.get('filter[match_status]');

  let query = supabase
    .from('bank_transactions')
    .select('*')
    .order('transaction_date', { ascending: false });
  if (bankAccountId) query = query.eq('bank_account_id', bankAccountId);
  if (matchStatus) query = query.eq('match_status', matchStatus);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'bank_transactions_list_failed',
          message: safeErrorMessage(error, 'Could not load bank transactions.', 'bankTransactions.list'),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ bankTransactions: (data ?? []).map(mapBankTransactionRow) });
}

export async function POST(request: NextRequest) {
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

  const parsed = bankTransactionCreateSchema.safeParse(body);
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

  const { data: bankAccount, error: bankAccountError } = await supabase
    .from('bank_accounts')
    .select('id, org_id')
    .eq('id', parsed.data.bankAccountId)
    .maybeSingle();
  if (bankAccountError) {
    return NextResponse.json(
      {
        error: {
          code: 'bank_account_fetch_failed',
          message: safeErrorMessage(bankAccountError, 'Could not load this bank account.', 'bankTransactions.create.fetchBankAccount'),
        },
      },
      { status: 500 },
    );
  }
  if (!bankAccount) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Bank account not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, bankAccount.org_id, 'accountant');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to add transactions to this bank account.',
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('bank_transactions')
    .insert({
      bank_account_id: parsed.data.bankAccountId,
      transaction_date: parsed.data.transactionDate,
      amount: parsed.data.amount,
      description: parsed.data.description ?? null,
      reference: parsed.data.reference ?? null,
      property_id: parsed.data.propertyId ?? null,
      unit_id: parsed.data.unitId ?? null,
      tenant_id: parsed.data.tenantId ?? null,
      vendor_id: parsed.data.vendorId ?? null,
      category: parsed.data.category ?? null,
      document_id: parsed.data.documentId ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'bank_transaction_create_failed',
          message: safeErrorMessage(
            error,
            'Could not add this transaction. Please try again, or contact support if this continues.',
            'bank_transactions insert',
          ),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ bankTransaction: mapBankTransactionRow(data) }, { status: 201 });
}
