import { NextResponse, type NextRequest } from 'next/server';
import { billingCheckoutSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { startSubscriptionCheckout } from '@/lib/billing';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * POST /api/v1/organizations/:orgId/billing/checkout -- self-serve checkout (Stage 4
 * commercial-launch execution plan), principal-only (same floor as PATCH
 * /api/v1/organizations/:orgId's canWrite check pattern, but stricter: manager cannot start a
 * subscription payment, only the org's principal can). The super_admin equivalent
 * (/api/v1/admin/organizations/:orgId/billing/checkout) still exists unchanged for staff-assisted
 * checkout; this is the org's own principal doing it themselves, no staff involved.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } }, { status: 400 });
  }

  const parsed = billingCheckoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Check the highlighted fields.', field_errors: parsed.error.flatten().fieldErrors } },
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
      actorUserId: user.id,
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
