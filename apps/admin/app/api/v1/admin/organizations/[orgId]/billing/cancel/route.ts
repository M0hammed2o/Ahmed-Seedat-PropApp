import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { cancelOrgSubscription } from '@/lib/billing';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * POST /api/v1/admin/organizations/:orgId/billing/cancel -- super_admin only, explicit
 * staff-triggered cancellation. No request body: the gateway token to cancel against is resolved
 * server-side from organization_subscriptions.provider_subscription_token
 * (cancelOrgSubscription), never accepted from the caller.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const guard = await requireAdminRoleOrRespond('super_admin');
  if ('response' in guard) return guard.response;

  const { orgId } = await params;
  const serviceClient = getServiceRoleClient();

  try {
    await cancelOrgSubscription(serviceClient, { orgId });

    await writeAuditEvent(serviceClient, {
      orgId,
      actorUserId: guard.session.authUserId,
      actorType: 'user',
      action: 'billing.subscription_cancelled',
      entityType: 'organization_subscriptions',
      entityId: orgId,
    });

    return NextResponse.json({ status: 'cancelled' });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'billing_cancel_failed', message: err instanceof Error ? err.message : 'Cancellation failed.' } },
      { status: 422 },
    );
  }
}
