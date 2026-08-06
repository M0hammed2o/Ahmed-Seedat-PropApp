import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { cancelOrgSubscription } from '@/lib/billing';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * POST /api/v1/organizations/:orgId/billing/cancel -- self-serve cancellation, principal-only.
 * Mirrors /api/v1/organizations/:orgId/billing/checkout's auth pattern exactly. No request body:
 * cancelOrgSubscription resolves the gateway token itself from
 * organization_subscriptions.provider_subscription_token.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { orgId } = await params;
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: { code: 'unauthenticated', message: 'Sign in required.' } }, { status: 401 });
  }

  const isPrincipal = await requireOrgRole(supabase, orgId, 'principal');
  if (!isPrincipal) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Only the organization principal can manage billing.' } },
      { status: 403 },
    );
  }

  const serviceClient = getServiceRoleClient();

  try {
    await cancelOrgSubscription(serviceClient, { orgId });

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
      { error: { code: 'billing_cancel_failed', message: err instanceof Error ? err.message : 'Cancellation failed.' } },
      { status: 422 },
    );
  }
}
