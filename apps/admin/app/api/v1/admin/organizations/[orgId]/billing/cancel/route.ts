import { NextResponse, type NextRequest } from 'next/server';
import { billingCancelSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { cancelOrgSubscription } from '@/lib/billing';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ orgId: string }> };

/** POST /api/v1/admin/organizations/:orgId/billing/cancel -- super_admin only, explicit staff-triggered cancellation. */
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

  const parsed = billingCancelSchema.safeParse(body);
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

  try {
    await cancelOrgSubscription(serviceClient, { orgId, providerSubscriptionId: parsed.data.providerSubscriptionId });

    await writeAuditEvent(serviceClient, {
      orgId,
      actorUserId: guard.session.authUserId,
      actorType: 'user',
      action: 'billing.subscription_cancelled',
      entityType: 'organization_subscriptions',
      entityId: orgId,
      after: { providerSubscriptionId: parsed.data.providerSubscriptionId },
    });

    return NextResponse.json({ status: 'cancelled' });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'billing_cancel_failed', message: err instanceof Error ? err.message : 'Cancellation failed.' } },
      { status: 422 },
    );
  }
}
