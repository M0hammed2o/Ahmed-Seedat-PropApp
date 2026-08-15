import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireBillingPrincipalAccess } from '@/lib/portfolio';
import { cancelOrgSubscription } from '@/lib/billing';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * POST /api/v1/organizations/:orgId/billing/cancel -- self-serve cancellation, principal-only.
 * Mirrors /api/v1/organizations/:orgId/billing/checkout's auth pattern exactly. No request body:
 * cancelOrgSubscription resolves the gateway token itself from
 * organization_subscriptions.provider_subscription_token.
 *
 * RELEASE A P0 fix: uses `requireBillingPrincipalAccess()`, not `requireOrgRole(..., 'principal')`
 * -- see checkout/route.ts's matching comment for the full reasoning. A cancelled org's own
 * principal must still be able to reach this route too (e.g. to clean up a duplicate/erroneous
 * subscription state), same as checkout.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { orgId } = await params;
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

  const isPrincipal = await requireBillingPrincipalAccess(supabase, orgId);
  if (!isPrincipal) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'Only the organization principal can manage billing.',
        },
      },
      { status: 403 },
    );
  }

  const serviceClient = getServiceRoleClient();

  try {
    await cancelOrgSubscription(serviceClient, { orgId, actorUserId: user.id });

    await writeAuditEvent(serviceClient, {
      orgId,
      actorUserId: user.id,
      actorType: 'user',
      action: 'billing.subscription_cancelled',
      entityType: 'organization_subscriptions',
      entityId: orgId,
    });

    return NextResponse.json({ status: 'cancelled' });
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'billing_cancel_failed',
          message: err instanceof Error ? err.message : 'Cancellation failed.',
        },
      },
      { status: 422 },
    );
  }
}
