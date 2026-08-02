import { NextResponse, type NextRequest } from 'next/server';
import { billingCheckoutSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { startSubscriptionCheckout } from '@/lib/billing';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * POST /api/v1/admin/organizations/:orgId/billing/checkout -- super_admin only, staff-initiated
 * (no org self-serve checkout UI exists yet, matching every other subscription action in this
 * codebase so far, e.g. PATCH .../plan). Never activates real billing (mock provider only) --
 * see apps/admin/lib/providers/billing.ts.
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

  const parsed = billingCheckoutSchema.safeParse(body);
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
    const result = await startSubscriptionCheckout(serviceClient, {
      orgId,
      planId: parsed.data.planId,
      idempotencyKey: parsed.data.idempotencyKey,
    });

    await writeAuditEvent(serviceClient, {
      orgId,
      actorUserId: guard.session.authUserId,
      actorType: 'user',
      action: 'billing.checkout_started',
      entityType: 'subscription_payments',
      entityId: result.subscriptionPaymentId,
      after: { providerSubscriptionId: result.providerSubscriptionId },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'billing_checkout_failed', message: err instanceof Error ? err.message : 'Checkout failed.' } },
      { status: 422 },
    );
  }
}
