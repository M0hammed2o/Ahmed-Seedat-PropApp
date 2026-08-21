import { NextResponse, type NextRequest } from 'next/server';
import { addonCapacityChangeSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireBillingPrincipalAccess } from '@/lib/portfolio';
import { setAddonCapacity } from '@/lib/addons';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * POST /api/v1/organizations/:orgId/billing/addons -- V1 commercial UX pass. Purchases or removes
 * extra property/owner capacity. Server-derived pricing throughout (lib/addons.ts) -- the client
 * only ever chooses a resourceType and targetQuantity, never a price or resulting total.
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

  const parsed = addonCapacityChangeSchema.safeParse(body);
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
    const result = await setAddonCapacity(serviceClient, {
      orgId,
      resourceType: parsed.data.resourceType,
      targetQuantity: parsed.data.targetQuantity,
      keepIds: parsed.data.keepIds,
      actorUserId: user.id,
      idempotencyKey: parsed.data.idempotencyKey,
    });

    await writeAuditEvent(serviceClient, {
      orgId,
      actorUserId: user.id,
      actorType: 'user',
      action: 'billing.addon_capacity_change_requested',
      entityType: 'organization_subscriptions',
      entityId: orgId,
      after: { resourceType: result.resourceType, newQuantity: result.newQuantity },
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Add-on change failed.';
    const code = message.startsWith('addon_not_supported_by_plan')
      ? 'addon_not_supported_by_plan'
      : message.startsWith('addon_removal_requires_selection')
        ? 'addon_removal_requires_selection'
        : message.startsWith('no_active_subscription_token')
          ? 'no_active_subscription_token'
          : message.startsWith('no_subscription')
            ? 'no_subscription'
            : message.startsWith('invalid_addon_quantity')
              ? 'invalid_addon_quantity'
              : 'addon_change_failed';
    return NextResponse.json({ error: { code, message } }, { status: code === 'addon_change_failed' ? 422 : 409 });
  }
}
