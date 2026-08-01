import { NextResponse, type NextRequest } from 'next/server';
import { organizationPlanUpdateSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * PATCH /api/v1/admin/organizations/:orgId/plan (API_SPEC.md §2, SUPER_ADMIN.md §4/§5) --
 * super_admin only. Covers plan change, price override, and discount in one endpoint (SUPER_ADMIN.md
 * §4: "Extend the plan-change endpoint" for discount, rather than a sibling route). Writes a NEW
 * `organization_subscriptions` row rather than updating the current one in place --
 * `organization_subscriptions` is explicitly append-only per period (DATABASE.md §1), so a plan/
 * price/discount change is itself a new period row, carrying forward whatever fields the caller
 * didn't touch from the previous current row.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

  const parsed = organizationPlanUpdateSchema.safeParse(body);
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
  if (parsed.data.planId === undefined && parsed.data.priceOverride === undefined && parsed.data.discountPct === undefined) {
    return NextResponse.json(
      { error: { code: 'no_changes', message: 'At least one of planId, priceOverride, or discountPct is required.' } },
      { status: 400 },
    );
  }

  const serviceClient = getServiceRoleClient();

  const { data: current, error: currentError } = await serviceClient
    .from('organization_subscriptions')
    .select('*')
    .eq('org_id', orgId)
    .order('current_period_start', { ascending: false })
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
      { error: { code: 'not_found', message: 'This organization has no subscription to change.' } },
      { status: 404 },
    );
  }

  const { data: updated, error: insertError } = await serviceClient
    .from('organization_subscriptions')
    .insert({
      org_id: orgId,
      plan_id: parsed.data.planId ?? current.plan_id,
      price_override: parsed.data.priceOverride !== undefined ? parsed.data.priceOverride : current.price_override,
      discount_pct: parsed.data.discountPct !== undefined ? parsed.data.discountPct : current.discount_pct,
      promotional_credit: current.promotional_credit,
      billing_cycle: current.billing_cycle,
      current_period_start: new Date().toISOString().slice(0, 10),
      current_period_end: current.current_period_end,
      next_payment_date: current.next_payment_date,
      status: current.status,
    })
    .select('*')
    .single();
  if (insertError) {
    return NextResponse.json(
      { error: { code: 'plan_update_failed', message: insertError.message } },
      { status: 500 },
    );
  }

  await writeAuditEvent(serviceClient, {
    orgId,
    actorUserId: guard.session.authUserId,
    actorType: 'user',
    action: 'organization.plan_change',
    entityType: 'organization_subscriptions',
    entityId: updated.id,
    before: { plan_id: current.plan_id, price_override: current.price_override, discount_pct: current.discount_pct },
    after: { plan_id: updated.plan_id, price_override: updated.price_override, discount_pct: updated.discount_pct },
  });

  return NextResponse.json({
    subscription: {
      id: updated.id,
      orgId: updated.org_id,
      planId: updated.plan_id,
      priceOverride: updated.price_override,
      discountPct: updated.discount_pct,
      promotionalCredit: updated.promotional_credit,
      billingCycle: updated.billing_cycle,
      currentPeriodStart: updated.current_period_start,
      currentPeriodEnd: updated.current_period_end,
      nextPaymentDate: updated.next_payment_date,
      status: updated.status,
      createdAt: updated.created_at,
    },
  });
}
