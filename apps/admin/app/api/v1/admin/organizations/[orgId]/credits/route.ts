import { NextResponse, type NextRequest } from 'next/server';
import { creditIssueSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * POST /api/v1/admin/organizations/:orgId/credits (API_SPEC.md §2, SUPER_ADMIN.md §4/§5) --
 * super_admin only. Adds to the CURRENT subscription period's `promotional_credit` in place
 * (unlike a plan change, this does not open a new period row) -- SUPER_ADMIN.md §2.3 explicitly
 * flags that `organization_subscriptions` captures current credit state only, not a historical
 * "credit issued on date X, by admin Y, reason Z" log, and recommends `audit_events` as that log
 * (schema already supports it) rather than a purpose-built table -- which is exactly what the
 * writeAuditEvent() call below is for. `reason` is required by the Zod schema specifically so
 * that audit trail is never empty.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = await requireAdminRoleOrRespond('super_admin');
  if ('response' in guard) return guard.response;

  const { orgId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = creditIssueSchema.safeParse(body);
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

  const serviceClient = getServiceRoleClient();

  const { data: current, error: currentError } = await serviceClient
    .from('organization_subscriptions')
    .select('id, promotional_credit')
    .eq('org_id', orgId)
    .order('current_period_start', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (currentError) {
    return NextResponse.json(
      { error: { code: 'subscription_fetch_failed', message: currentError.message } },
      { status: 500 },
    );
  }
  if (!current) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'This organization has no subscription to credit.' } },
      { status: 404 },
    );
  }

  const newTotal = current.promotional_credit + parsed.data.amount;
  const { data: updated, error: updateError } = await serviceClient
    .from('organization_subscriptions')
    .update({ promotional_credit: newTotal })
    .eq('id', current.id)
    .select('id, org_id, promotional_credit')
    .single();
  if (updateError) {
    return NextResponse.json(
      { error: { code: 'credit_issue_failed', message: updateError.message } },
      { status: 500 },
    );
  }

  await writeAuditEvent(serviceClient, {
    orgId,
    actorUserId: guard.session.authUserId,
    actorType: 'user',
    action: 'organization.credit_issued',
    entityType: 'organization_subscriptions',
    entityId: current.id,
    before: { promotional_credit: current.promotional_credit },
    after: {
      promotional_credit: newTotal,
      amount_issued: parsed.data.amount,
      reason: parsed.data.reason,
    },
  });

  return NextResponse.json({
    subscription: {
      id: updated.id,
      orgId: updated.org_id,
      promotionalCredit: updated.promotional_credit,
    },
  });
}
