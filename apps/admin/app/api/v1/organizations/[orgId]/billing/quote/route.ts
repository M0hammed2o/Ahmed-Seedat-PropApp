import { NextResponse, type NextRequest } from 'next/server';
import { billingPlanChangeQuoteSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireBillingPrincipalAccess } from '@/lib/portfolio';
import { computeDowngradeImpact } from '@/lib/downgradeImpact';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * POST /api/v1/organizations/:orgId/billing/quote -- RELEASE A (Phase 10). Server-generated,
 * short-lived quote for a plan change (upgrade/downgrade/reactivation/new subscription),
 * classified and priced entirely by compute_plan_change_quote()/create_plan_change_quote()
 * (migration 20260101000104) -- this route never computes or trusts a client-supplied amount.
 *
 * Uses requireBillingPrincipalAccess(), not requireOrgRole(..., 'principal') -- a suspended/
 * cancelled org's own principal must be able to see what reactivating would cost, which is exactly
 * the scenario has_org_role() would otherwise block (see billing/checkout/route.ts's matching
 * comment).
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

  const parsed = billingPlanChangeQuoteSchema.safeParse(body);
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

  const { data: quote, error } = await supabase
    .rpc('create_plan_change_quote', {
      p_org_id: orgId,
      p_target_plan_id: parsed.data.targetPlanId,
    })
    .single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'billing_quote_failed', message: error.message } },
      { status: 422 },
    );
  }

  const row = quote as {
    id: string;
    change_type: string;
    current_plan_id: string | null;
    target_plan_id: string;
    current_effective_price: number | null;
    target_effective_price: number;
    current_period_start: string | null;
    current_period_end: string | null;
    proration_fraction: number | null;
    amount_due_now: number;
    next_renewal_amount: number | null;
    currency: string;
    effective_at: string;
    expires_at: string;
  };

  // V1 commercial UX pass: a downgrade quote also carries a full impact preview -- current usage
  // vs. the target plan's real allowance, per resource type -- so the client can never present a
  // misleading one-click "confirm" that hides what's about to be restricted. Computed read-only,
  // from the same entitlement-limit source of truth reconcile_plan_limits() itself reads.
  const downgradeImpact =
    row.change_type === 'downgrade'
      ? await computeDowngradeImpact(supabase, orgId, parsed.data.targetPlanId)
      : null;

  // Safe fields only -- no internal secrets/provider tokens (never present on this row anyway,
  // but the response shape is spelled out explicitly rather than passing the raw row through).
  return NextResponse.json({
    quoteId: row.id,
    changeType: row.change_type,
    currentPlanId: row.current_plan_id,
    targetPlanId: row.target_plan_id,
    currentEffectivePrice: row.current_effective_price,
    targetEffectivePrice: row.target_effective_price,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    prorationFraction: row.proration_fraction,
    amountDueNow: row.amount_due_now,
    nextRenewalAmount: row.next_renewal_amount,
    currency: row.currency,
    effectiveAt: row.effective_at,
    expiresAt: row.expires_at,
    downgradeImpact,
  });
}
