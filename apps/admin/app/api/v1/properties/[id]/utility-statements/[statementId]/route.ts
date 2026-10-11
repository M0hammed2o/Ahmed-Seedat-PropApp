import { NextResponse, type NextRequest } from 'next/server';
import { statementActionSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { canWriteUtilities, forbidden, jsonError, loadReadableProperty, notFound, parseJson, requireUser, serverError, utilitiesDisabled } from '@/lib/smartUtility/http';
import { renderStatementPdf, statementAction, StatementError } from '@/lib/smartUtility/statements';

type RouteParams = { params: Promise<{ id: string; statementId: string }> };

/**
 * GET — the statement as PDF. Read on the caller's session: staff see any statement of a property they can read;
 * a tenant only their own approved/sent statement (RLS utility_statements_select_tenant_self). Drafts carry a
 * DRAFT banner.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id, statementId } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const { data: s, error } = await auth.supabase
    .from('utility_statements')
    .select('id, status, period_start, snapshot')
    .eq('id', statementId)
    .eq('property_id', id)
    .maybeSingle();
  if (error) return serverError('statement_failed', 'Could not load the statement.', 'utility_statements.get', error);
  if (!s) return notFound('Statement');
  try {
    const pdf = await renderStatementPdf(s.snapshot as Parameters<typeof renderStatementPdf>[0], { draft: s.status === 'draft' });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="utility-statement-${s.period_start}.pdf"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (err) {
    return serverError('statement_pdf_failed', 'Could not render the statement.', 'utility_statements.pdf', err);
  }
}

/** POST {action: approve | void | send} — staff review. Send is tenant-only, approved-only, flag-gated. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id, statementId } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, statementActionSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!property.utilities_enabled) return utilitiesDisabled();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  try {
    return NextResponse.json(
      await statementAction(getServiceRoleClient(), { statementId, propertyId: property.id, action: parsed.data.action, actorUserId: auth.user.id }),
    );
  } catch (error) {
    if (error instanceof StatementError) return jsonError(409, 'statement_rejected', error.message);
    return serverError('statement_action_failed', 'Could not complete that action.', 'utility_statements.action', error);
  }
}
