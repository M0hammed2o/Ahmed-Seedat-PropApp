import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { levyStatementLineItemSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapLevyStatementLineItemRow } from '@/lib/compliance';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

const replaceLineItemsSchema = z.object({ lineItems: z.array(levyStatementLineItemSchema) });

/**
 * PUT /api/v1/levy-statements/:id/line-items -- the human REVIEW/correction step (PHASE 11: "user
 * confirms or corrects"). Replaces the statement's full line-item set with the caller's corrected
 * version in one call (delete-then-insert, matching a review screen where staff edits a table and
 * submits once) rather than granular per-row CRUD -- simpler and matches how review actually
 * happens: correcting one OCR-heuristic guess, adding a missed line, removing a false positive,
 * then submitting the whole corrected set together. Every item this route writes is
 * `source: 'manual'` (a human-confirmed value), regardless of whether it started life as an
 * ocr_heuristic guess -- once reviewed, the origin no longer matters for correctness purposes.
 * Never posts to accounting.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
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

  const { data: statement } = await supabase
    .from('levy_statements')
    .select('org_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!statement) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Levy statement not found.' } },
      { status: 404 },
    );
  }
  if (!(await requireOrgRole(supabase, statement.org_id, 'agent'))) {
    return NextResponse.json(
      {
        error: { code: 'forbidden', message: 'You do not have permission to edit this statement.' },
      },
      { status: 403 },
    );
  }
  if (statement.status === 'reviewed') {
    return NextResponse.json(
      {
        error: {
          code: 'already_reviewed',
          message: 'This statement has already been reviewed. Reopen it before editing line items.',
        },
      },
      { status: 409 },
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
  const parsed = replaceLineItemsSchema.safeParse(body);
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

  const { error: deleteError } = await supabase
    .from('levy_statement_line_items')
    .delete()
    .eq('statement_id', id);
  if (deleteError) {
    return NextResponse.json(
      {
        error: {
          code: 'line_items_replace_failed',
          message: safeErrorMessage(
            deleteError,
            'Could not save the line items for this statement. Please try again, or contact support if this continues.',
            `levy_statement_line_items.delete(${id})`,
          ),
        },
      },
      { status: 500 },
    );
  }

  if (parsed.data.lineItems.length === 0) {
    return NextResponse.json({ lineItems: [] });
  }

  const { data: inserted, error: insertError } = await supabase
    .from('levy_statement_line_items')
    .insert(
      parsed.data.lineItems.map((item) => ({
        statement_id: id,
        org_id: statement.org_id,
        line_type: item.lineType,
        category: item.category,
        description: item.description ?? null,
        amount: item.amount,
        source: 'manual',
        confidence: null,
        sort_order: item.sortOrder,
      })),
    )
    .select('*');
  if (insertError) {
    return NextResponse.json(
      {
        error: {
          code: 'line_items_replace_failed',
          message: safeErrorMessage(
            insertError,
            'Could not save the line items for this statement. Please try again, or contact support if this continues.',
            `levy_statement_line_items.insert(${id})`,
          ),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ lineItems: (inserted ?? []).map(mapLevyStatementLineItemRow) });
}
