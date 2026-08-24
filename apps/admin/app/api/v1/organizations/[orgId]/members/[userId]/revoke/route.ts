import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { isPrincipalOnlyDenial } from '@/lib/staffAuthorizationErrors';

type RouteParams = { params: Promise<{ orgId: string; userId: string }> };

/**
 * POST /api/v1/organizations/:orgId/members/:userId/revoke (owner + staff access completion
 * pass, WORKLOG.md this date) -- thin wrapper over revoke_organization_member() (migration
 * 20260101000090), which enforces manager+ and the last-Principal guard, and clears the member's
 * property_access grants in this org.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { orgId, userId } = await params;
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

  const { error } = await supabase.rpc('revoke_organization_member', {
    p_org_id: orgId,
    p_user_id: userId,
  });
  if (error) {
    // Staff security + audit hardening follow-up (this date): narrow, exact-match mapping to 403
    // for the RPC's own known principal-only denial only -- see lib/staffAuthorizationErrors.ts.
    const status = isPrincipalOnlyDenial(error.message) ? 403 : 400;
    return NextResponse.json(
      { error: { code: 'revoke_failed', message: error.message } },
      { status },
    );
  }

  return NextResponse.json({ ok: true });
}
