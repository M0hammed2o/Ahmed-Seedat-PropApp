import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/levy-statements/:id/review -- a human confirming the (possibly corrected) line
 * items are accurate, mirroring POST /api/v1/documents/:id/review's own "confirm, don't
 * correct-and-auto-apply" pattern exactly. Sets reviewed_by/reviewed_at/status: 'reviewed'.
 *
 * Deliberately does NOT create any expense/journal entry/owner-statement-line/tenant-recoverable-
 * charge -- PHASE 12's explicit boundary. Whether a given line item is an owner expense or a
 * recoverable tenant charge is not determinable from the statement text alone (the same
 * managing-agent statement can contain both), so converting a reviewed line item into a real
 * accounting posting is a deliberate, disclosed follow-up, not guessed at here.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
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
        error: {
          code: 'forbidden',
          message: 'You do not have permission to review this statement.',
        },
      },
      { status: 403 },
    );
  }

  const { error } = await supabase
    .from('levy_statements')
    .update({ status: 'reviewed', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    return NextResponse.json(
      { error: { code: 'review_failed', message: error.message } },
      { status: 500 },
    );
  }

  const serviceRole = getServiceRoleClient();
  await writeAuditEvent(serviceRole, {
    orgId: statement.org_id,
    actorUserId: user.id,
    actorType: 'user',
    action: 'levy_statement.reviewed',
    entityType: 'levy_statements',
    entityId: id,
    after: { status: 'reviewed' },
  });

  return NextResponse.json({ reviewed: true });
}
