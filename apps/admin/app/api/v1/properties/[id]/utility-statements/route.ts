import { NextResponse, type NextRequest } from 'next/server';
import { statementGenerateSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { canWriteUtilities, forbidden, jsonError, loadReadableProperty, notFound, parseJson, requireUser, serverError, utilitiesDisabled } from '@/lib/smartUtility/http';
import { generateStatements, StatementError, tenantStatementsEnabled } from '@/lib/smartUtility/statements';

type RouteParams = { params: Promise<{ id: string }> };

/** GET — statements for the property (all statuses for staff; RLS limits tenants to their approved/sent ones). */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const { data, error } = await auth.supabase
    .from('utility_statements')
    .select('id, audience, lease_id, tenant_id, period_start, period_end, status, approved_at, sent_at, sent_to, created_at, snapshot')
    .eq('property_id', id)
    .order('period_start', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return serverError('statements_failed', 'Could not load statements.', 'utility_statements.list', error);
  return NextResponse.json({
    statements: (data ?? []).map(({ snapshot, ...s }) => {
      const snap = snapshot as { unitLabel?: string | null; tenantName?: string | null; totals?: { total?: number } } | null;
      return { ...s, unitLabel: snap?.unitLabel ?? null, tenantName: snap?.tenantName ?? null, total: snap?.totals?.total ?? null };
    }),
    tenantSendingEnabled: tenantStatementsEnabled(),
  });
}

/** POST {periodStart, periodEnd, audience} — prepare DRAFT statements from approved/invoiced charges (idempotent). */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, statementGenerateSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!property.utilities_enabled) return utilitiesDisabled();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  try {
    const result = await generateStatements(getServiceRoleClient(), { propertyId: property.id, ...parsed.data, actorUserId: auth.user.id });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof StatementError) return jsonError(409, 'statement_rejected', error.message);
    return serverError('statements_generate_failed', 'Could not prepare statements.', 'utility_statements.generate', error);
  }
}
