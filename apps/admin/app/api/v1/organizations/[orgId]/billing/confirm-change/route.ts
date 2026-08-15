import { NextResponse, type NextRequest } from 'next/server';
import { billingPlanChangeConfirmSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireBillingPrincipalAccess } from '@/lib/portfolio';
import { startPlanChangeCheckout, dispatchPlanChangeLifecycleEmail } from '@/lib/billing';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * POST /api/v1/organizations/:orgId/billing/confirm-change -- RELEASE A (Phase 7-12). Confirms a
 * previously-quoted plan change. confirm_plan_change() (migration 20260101000104) always
 * recomputes fresh server-side and is idempotent by quoteId (a double-click/retry with the same
 * quoteId returns the identical prior outcome, never a second change) -- this route additionally
 * generates its own request-scoped idempotencyKey for the gateway checkout call itself, so a
 * browser retry of THIS route cannot create two gateway subscriptions even if confirm_plan_change
 * somehow raced ahead of the quote-level idempotency (defense in depth, not a substitute for it).
 *
 * Three possible outcomes:
 *   - a zero-charge change (immediate upgrade with a $0 difference, or a same-plan no-op) is
 *     already fully applied by confirm_plan_change() itself -- nothing further to do.
 *   - a downgrade is scheduled for current_period_end -- nothing further to do now.
 *   - an upgrade/reactivation requiring real payment returns requiresPayment: true -- this route
 *     then starts a gateway checkout for the EXACT server-computed prorated amount and returns a
 *     checkoutUrl; the plan only actually flips once processBillingWebhookEvent confirms payment.
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

  const parsed = billingPlanChangeConfirmSchema.safeParse(body);
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

  const { data: confirmation, error: confirmError } = await supabase
    .rpc('confirm_plan_change', { p_quote_id: parsed.data.quoteId })
    .single();
  if (confirmError) {
    return NextResponse.json(
      { error: { code: 'billing_change_confirm_failed', message: confirmError.message } },
      { status: 422 },
    );
  }

  const result = confirmation as {
    billing_plan_change_id: string;
    change_type: string;
    status: string;
    amount_due_now: number;
    currency: string;
    effective_at: string;
    requires_payment: boolean;
    already_processed: boolean;
  };

  const serviceClient = getServiceRoleClient();

  await writeAuditEvent(serviceClient, {
    orgId,
    actorUserId: user.id,
    actorType: 'user',
    action: 'billing.plan_change_confirmed',
    entityType: 'billing_plan_changes',
    entityId: result.billing_plan_change_id,
    after: {
      changeType: result.change_type,
      status: result.status,
      amountDueNow: result.amount_due_now,
      alreadyProcessed: result.already_processed,
    },
  });

  if (!result.requires_payment) {
    // V1 communications productionisation (WORKLOG.md this date): a $0 upgrade, a scheduled
    // downgrade, or a $0 reactivation is already fully applied above by confirm_plan_change()
    // itself -- notify now, synchronously, since (unlike the paid path below) no later webhook
    // will ever fire for this change. Best-effort: never fails the request over a notification.
    if (!result.already_processed && result.change_type !== 'no_change') {
      const { data: changeRow } = await serviceClient
        .from('billing_plan_changes')
        .select('new_plan_id')
        .eq('id', result.billing_plan_change_id)
        .maybeSingle();
      if (changeRow?.new_plan_id) {
        await dispatchPlanChangeLifecycleEmail(serviceClient, {
          orgId,
          billingPlanChangeId: result.billing_plan_change_id,
          changeType: result.change_type,
          newPlanId: changeRow.new_plan_id,
          amountDueNow: result.amount_due_now,
          effectiveAt: result.effective_at,
          toEmail: user.email ?? null,
        });
      }
    }

    return NextResponse.json({
      billingPlanChangeId: result.billing_plan_change_id,
      changeType: result.change_type,
      status: result.status,
      amountDueNow: result.amount_due_now,
      currency: result.currency,
      effectiveAt: result.effective_at,
    });
  }

  const { data: changeRow, error: changeFetchError } = await serviceClient
    .from('billing_plan_changes')
    .select('new_plan_id')
    .eq('id', result.billing_plan_change_id)
    .single();
  if (changeFetchError || !changeRow?.new_plan_id) {
    return NextResponse.json(
      {
        error: {
          code: 'billing_change_confirm_failed',
          message:
            changeFetchError?.message ?? 'Could not resolve the target plan for this change.',
        },
      },
      { status: 500 },
    );
  }

  try {
    const checkout = await startPlanChangeCheckout(serviceClient, {
      orgId,
      billingPlanChangeId: result.billing_plan_change_id,
      targetPlanId: changeRow.new_plan_id,
      amountDueNow: result.amount_due_now,
      idempotencyKey: `plan-change:${result.billing_plan_change_id}`,
    });

    return NextResponse.json({
      billingPlanChangeId: result.billing_plan_change_id,
      changeType: result.change_type,
      status: result.status,
      amountDueNow: result.amount_due_now,
      currency: result.currency,
      effectiveAt: result.effective_at,
      checkoutUrl: checkout.checkoutUrl,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'billing_checkout_failed',
          message: err instanceof Error ? err.message : 'Checkout failed.',
        },
      },
      { status: 422 },
    );
  }
}
