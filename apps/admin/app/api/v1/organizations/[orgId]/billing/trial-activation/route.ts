import { NextResponse, type NextRequest } from 'next/server';
import { trialActivationCheckoutSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireBillingPrincipalAccess } from '@/lib/portfolio';
import { startTrialActivationCheckout } from '@/lib/billing';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * POST /api/v1/organizations/:orgId/billing/trial-activation -- commercial plan restructure, the
 * self-serve entry point for a brand-new organization's principal to select a plan tier +
 * billing interval and be handed a PayFast checkout URL that registers a real, verifiable
 * payment method (charges nothing now -- see startTrialActivationCheckout's own comment). Same
 * principal-only floor as the existing .../billing/checkout route
 * (requireBillingPrincipalAccess(), not requireOrgRole()), so a not-yet-set-up org's own
 * principal can still reach this even though has_org_role() would otherwise restrict them (this
 * route's own DB writes all run through the service-role client, matching every other billing
 * mutation in this codebase).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = trialActivationCheckoutSchema.safeParse(body);
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
    const result = await startTrialActivationCheckout(serviceClient, {
      orgId,
      principalUserId: user.id,
      planTier: parsed.data.planTier,
      interval: parsed.data.interval,
      idempotencyKey: parsed.data.idempotencyKey,
    });

    await writeAuditEvent(serviceClient, {
      orgId,
      actorUserId: user.id,
      actorType: 'user',
      action: 'billing.trial_activation_checkout_started',
      entityType: 'subscription_payments',
      entityId: result.subscriptionPaymentId,
      after: { providerSubscriptionId: result.providerSubscriptionId },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Checkout failed.';
    const code = message.startsWith('trial_not_eligible')
      ? 'trial_not_eligible'
      : message.startsWith('commercial_setup_already_complete')
        ? 'commercial_setup_already_complete'
        : 'billing_checkout_failed';
    return NextResponse.json({ error: { code, message } }, { status: code === 'billing_checkout_failed' ? 422 : 409 });
  }
}
