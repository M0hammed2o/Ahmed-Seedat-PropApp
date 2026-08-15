import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireBillingPrincipalAccess } from '@/lib/portfolio';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * GET /api/v1/organizations/:orgId/billing/pending-change -- RELEASE A (Phase 17). The org's
 * currently scheduled downgrade, if any, for the Billing UI's "Scheduled plan: Starter, Effective:
 * [date]" display. Plain RLS-scoped read (billing_plan_changes_select_same_org, migration
 * 20260101000104) -- no principal check needed for a read any org member can already see.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
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

  const { data, error } = await supabase
    .from('billing_plan_changes')
    .select('id, new_plan_id, effective_at, requested_at')
    .eq('org_id', orgId)
    .eq('status', 'scheduled')
    .eq('change_type', 'downgrade')
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: { code: 'pending_change_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    pendingChange: data
      ? {
          billingPlanChangeId: data.id,
          scheduledPlanId: data.new_plan_id,
          effectiveAt: data.effective_at,
          requestedAt: data.requested_at,
        }
      : null,
  });
}

/**
 * DELETE /api/v1/organizations/:orgId/billing/pending-change -- RELEASE A (Phase 9). Cancels the
 * org's pending scheduled downgrade, if any. cancel_pending_plan_change() (migration
 * 20260101000104) is an idempotent no-op if nothing is scheduled -- returns 200 either way, never
 * a 404, matching this codebase's established "cancel is safe to call repeatedly" convention.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
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

  const { data: cancelled, error } = await supabase
    .rpc('cancel_pending_plan_change', { p_org_id: orgId })
    .single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'pending_change_cancel_failed', message: error.message } },
      { status: 422 },
    );
  }

  if (cancelled) {
    const serviceClient = getServiceRoleClient();
    await writeAuditEvent(serviceClient, {
      orgId,
      actorUserId: user.id,
      actorType: 'user',
      action: 'billing.pending_downgrade_cancelled',
      entityType: 'billing_plan_changes',
      entityId: orgId,
    });
  }

  return NextResponse.json({ cancelled: cancelled === true });
}
