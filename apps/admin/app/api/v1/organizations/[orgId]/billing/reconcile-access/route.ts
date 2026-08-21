import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireBillingPrincipalAccess } from '@/lib/portfolio';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * POST /api/v1/organizations/:orgId/billing/reconcile-access -- V1 commercial UX pass. A safe,
 * idempotent manual trigger for reconcile_plan_limits() with no keep-lists (the deterministic
 * default). An upgrade or add-on purchase already calls this automatically -- this route exists
 * for the other way capacity frees up: the customer archiving a restricted property or removing a
 * staff member/owner themselves, which nothing else re-triggers reconciliation for. Powers the
 * "Restore all" action on the billing page's restricted-resources summary.
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
  const { error } = await serviceClient.rpc('reconcile_plan_limits', {
    p_org_id: orgId,
    p_actor_user_id: user.id,
    p_change_reason: 'manual_reconcile',
  });
  if (error) {
    return NextResponse.json(
      { error: { code: 'reconcile_failed', message: error.message } },
      { status: 422 },
    );
  }

  const [{ count: restrictedProperties }, { count: restrictedOwners }, { count: suspendedStaff }] =
    await Promise.all([
      serviceClient
        .from('properties')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('restricted_by_plan', true),
      serviceClient
        .from('owners')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('restricted_by_plan', true),
      serviceClient
        .from('organization_members')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('suspended_by_plan', true),
    ]);

  return NextResponse.json({
    restrictedProperties: restrictedProperties ?? 0,
    restrictedOwners: restrictedOwners ?? 0,
    suspendedStaff: suspendedStaff ?? 0,
  });
}
