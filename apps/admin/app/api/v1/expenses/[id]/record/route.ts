import { NextResponse, type NextRequest } from 'next/server';
import { expenseRecordSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { mapExpenseRow } from '@/lib/accounting';
import { writeAuditEvent } from '@/lib/audit';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/expenses/:id/record -- thin wrapper over record_expense() (migration 20260101000038). */
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

  let body: unknown = {};
  const rawBody = await request.text();
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
        { status: 400 },
      );
    }
  }

  const parsed = expenseRecordSchema.safeParse(body);
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

  const { data: before } = await supabase
    .from('expenses')
    .select('org_id, status, amount, document_id')
    .eq('id', id)
    .maybeSingle();

  // Evidence gate (V1 launch-completion pass): record_expense() itself is untouched -- this is a
  // pre-check in front of it. A 'pending' expense may exist with no supporting document (the
  // upload is optional at creation time, ExpenseForm.tsx), but posting it to the ledger without
  // any evidence at all must be a deliberate, justified exception, not silent. `before` can be
  // null here (unknown/already-deleted id) -- that case still falls through to record_expense()
  // itself below, which raises its own "Expense not found" error; this gate only fires when an
  // expense row is confirmed to exist and has no document_id.
  const hasEvidence = Boolean(before?.document_id);
  if (before && !hasEvidence && !parsed.data.exceptionReason) {
    return NextResponse.json(
      {
        error: {
          code: 'evidence_required',
          message: 'Attach supporting evidence, or provide a reason for posting without it.',
          field_errors: { exceptionReason: ['Required when no evidence is attached.'] },
        },
      },
      { status: 400 },
    );
  }

  const { error: recordError } = await supabase.rpc('record_expense', {
    p_expense_id: id,
    p_paid_immediately: parsed.data.paidImmediately,
  });

  if (recordError) {
    return NextResponse.json(
      {
        error: {
          code: 'expense_record_failed',
          message: safeErrorMessage(
            recordError,
            'Could not record this expense. Please try again, or contact support if this continues.',
            `record_expense(${id})`,
          ),
        },
      },
      { status: 500 },
    );
  }

  const { data, error: fetchError } = await supabase
    .from('expenses')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError) {
    return NextResponse.json(
      {
        error: {
          code: 'expense_fetch_failed',
          message: safeErrorMessage(
            fetchError,
            'Expense was recorded, but could not be reloaded. Refresh to see its current status.',
            `expenses.select(${id})`,
          ),
        },
      },
      { status: 500 },
    );
  }

  // Governance requirement: "who recorded this expense as paid, and what changed" — the
  // pre-RPC fetch above is the only chance to capture the prior status, since record_expense()
  // mutates it in place. Written unconditionally, exactly as before the evidence gate existed --
  // the exception audit below is additional, not a replacement.
  await writeAuditEvent(getServiceRoleClient(), {
    orgId: data.org_id,
    actorUserId: user.id,
    actorType: 'user',
    action: 'expense.record',
    entityType: 'expenses',
    entityId: id,
    before: before ? { status: before.status, amount: before.amount } : null,
    after: {
      status: data.status,
      amount: data.amount,
      paidImmediately: parsed.data.paidImmediately,
    },
  });

  // Evidence-exception audit (V1 launch-completion pass): only fires when the expense had no
  // document_id AND an exceptionReason was supplied -- the evidence gate above already rejected
  // the no-evidence/no-reason case with a 400 before reaching this point, so by the time we get
  // here `!hasEvidence` implies exceptionReason is set. Never written when evidence was present.
  if (!hasEvidence) {
    await writeAuditEvent(getServiceRoleClient(), {
      orgId: data.org_id,
      actorUserId: user.id,
      actorType: 'user',
      action: 'expense.posted_without_evidence',
      entityType: 'expenses',
      entityId: id,
      after: { reason: parsed.data.exceptionReason },
    });
  }

  return NextResponse.json({ expense: mapExpenseRow(data) });
}
