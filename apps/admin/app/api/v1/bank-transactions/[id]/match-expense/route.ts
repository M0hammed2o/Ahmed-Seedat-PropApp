import { NextResponse, type NextRequest } from 'next/server';
import { bankTransactionMatchExpenseSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { mapBankTransactionRow } from '@/lib/accounting';
import { writeAuditEvent } from '@/lib/audit';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/bank-transactions/:id/match-expense (V1 launch-completion pass). Thin wrapper
 * over match_bank_transaction_to_expense() (migration 20260101000146) -- the second real
 * matching destination alongside the existing rent-schedule case
 * (POST /api/v1/bank-transactions/:id/confirm-match), reconciling a bank-statement line against
 * an existing pending expense the staff already recorded manually.
 *
 * Audit note: confirm_bank_transaction_match() and its own confirm-match route currently write no
 * audit_events row at all (verified -- bank_transactions has no org_id column, so the generic
 * log_audit_event_trigger() was deliberately NOT extended to it, migration
 * 20260101000125's own comment). Rather than leaving this new destination unaudited too, this
 * route writes one explicitly here, matching the writeAuditEvent() convention every other new
 * mutating endpoint this milestone already uses (e.g. expenses/[id]/record).
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

  const parsed = bankTransactionMatchExpenseSchema.safeParse(body);
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

  // Pre-RPC snapshot for the audit row's "before" -- match_bank_transaction_to_expense() mutates
  // both rows in place, so this is the only chance to capture prior state.
  const { data: before } = await supabase
    .from('bank_transactions')
    .select('match_status, matched_journal_entry_id, expense_id')
    .eq('id', id)
    .maybeSingle();

  const { error: matchError } = await supabase.rpc('match_bank_transaction_to_expense', {
    p_bank_transaction_id: id,
    p_expense_id: parsed.data.expenseId,
  });

  if (matchError) {
    return NextResponse.json(
      {
        error: {
          code: 'match_expense_failed',
          message: safeErrorMessage(
            matchError,
            'Could not match this transaction to the expense. Please try again, or contact support if this continues.',
            `match_bank_transaction_to_expense(${id})`,
          ),
        },
      },
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

  const serviceClient = getServiceRoleClient();
  const { data: bankAccount } = await serviceClient
    .from('bank_accounts')
    .select('org_id')
    .eq('id', data.bank_account_id)
    .maybeSingle();

  await writeAuditEvent(serviceClient, {
    orgId: bankAccount?.org_id ?? null,
    actorUserId: user.id,
    actorType: 'user',
    action: 'bank_transaction.match_expense',
    entityType: 'bank_transactions',
    entityId: id,
    before: before ?? null,
    after: {
      matchStatus: data.match_status,
      matchedJournalEntryId: data.matched_journal_entry_id,
      expenseId: data.expense_id,
    },
  });

  return NextResponse.json({ bankTransaction: mapBankTransactionRow(data) });
}
