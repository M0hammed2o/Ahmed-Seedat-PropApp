import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireBillingPrincipalAccess } from '@/lib/portfolio';
import { startPaymentMethodUpdateCheckout } from '@/lib/billing';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * POST /api/v1/organizations/:orgId/billing/payment-method -- V1 commercial onboarding pass,
 * Phase 18. Principal-only (same has_billing_principal_access() floor as every other billing
 * mutation route in this codebase -- reachable even for a suspended/overdue org, since updating
 * the payment method is exactly how a restricted org recovers).
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
    const result = await startPaymentMethodUpdateCheckout(serviceClient, {
      orgId,
      idempotencyKey: `payment-method-update-${orgId}-${randomUUID()}`,
    });

    await writeAuditEvent(serviceClient, {
      orgId,
      actorUserId: user.id,
      actorType: 'user',
      action: 'billing.payment_method_update_started',
      entityType: 'subscription_payments',
      entityId: result.subscriptionPaymentId,
      after: { providerSubscriptionId: result.providerSubscriptionId },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Checkout failed.';
    const code = message.startsWith('commercial_setup_not_complete')
      ? 'commercial_setup_not_complete'
      : 'billing_checkout_failed';
    return NextResponse.json(
      { error: { code, message } },
      { status: code === 'billing_checkout_failed' ? 422 : 409 },
    );
  }
}
