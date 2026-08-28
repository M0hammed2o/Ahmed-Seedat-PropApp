import { NextResponse, type NextRequest } from 'next/server';
import { expenseAttachEvidenceSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapExpenseRow } from '@/lib/accounting';
import { writeAuditEvent } from '@/lib/audit';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/expenses/:id/attach-evidence (V1 launch-completion pass). Lets supporting evidence
 * (a document already uploaded via POST /api/v1/documents) be linked to a 'pending' expense that
 * was created without one -- the expense-detail-page counterpart to ExpenseForm.tsx's own
 * upload-at-creation path. A plain RLS-protected column write (`expenses_write_accountant_plus`,
 * migration 20260101000037), never a journal-entry write -- record_expense() is untouched by this
 * route entirely. Restricted to 'pending' expenses only: once recorded, whether evidence was
 * attached is a historical fact captured by the record route's own audit trail (expense.record /
 * expense.posted_without_evidence), not something this route should let anyone quietly rewrite
 * after the fact.
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

  const parsed = expenseAttachEvidenceSchema.safeParse(body);
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

  const { data: expense, error: fetchError } = await supabase
    .from('expenses')
    .select('org_id, status, document_id')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      {
        error: {
          code: 'expense_fetch_failed',
          message: safeErrorMessage(
            fetchError,
            'Could not load this expense. Please try again.',
            `expenses.select(${id})`,
          ),
        },
      },
      { status: 500 },
    );
  }
  if (!expense) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Expense not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, expense.org_id, 'accountant');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to attach evidence to expenses for this organization.',
        },
      },
      { status: 403 },
    );
  }

  if (expense.status !== 'pending') {
    return NextResponse.json(
      {
        error: {
          code: 'expense_not_pending',
          message: 'Evidence can only be attached before this expense is recorded.',
        },
      },
      { status: 409 },
    );
  }

  // Cross-org confirmation: the document must actually belong to the same org as the expense --
  // a plain RLS-scoped read through the caller's own session, not a service-role bypass, so a
  // caller who can't see the document at all (wrong org) gets a 400 here, not a silent cross-org
  // link.
  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('id')
    .eq('id', parsed.data.documentId)
    .eq('org_id', expense.org_id)
    .is('deleted_at', null)
    .maybeSingle();
  if (documentError) {
    return NextResponse.json(
      {
        error: {
          code: 'document_fetch_failed',
          message: safeErrorMessage(
            documentError,
            'Could not verify this document. Please try again.',
            `documents.select(${parsed.data.documentId})`,
          ),
        },
      },
      { status: 500 },
    );
  }
  if (!document) {
    return NextResponse.json(
      { error: { code: 'document_not_found', message: 'Document not found.' } },
      { status: 400 },
    );
  }

  const { data, error: updateError } = await supabase
    .from('expenses')
    .update({ document_id: parsed.data.documentId })
    .eq('id', id)
    .select('*')
    .single();
  if (updateError) {
    return NextResponse.json(
      {
        error: {
          code: 'expense_update_failed',
          message: safeErrorMessage(
            updateError,
            'Could not attach evidence to this expense. Please try again.',
            `expenses.update(${id})`,
          ),
        },
      },
      { status: 500 },
    );
  }

  await writeAuditEvent(getServiceRoleClient(), {
    orgId: expense.org_id,
    actorUserId: user.id,
    actorType: 'user',
    action: 'expense.evidence_attached',
    entityType: 'expenses',
    entityId: id,
    before: { documentId: expense.document_id },
    after: { documentId: parsed.data.documentId },
  });

  return NextResponse.json({ expense: mapExpenseRow(data) });
}
