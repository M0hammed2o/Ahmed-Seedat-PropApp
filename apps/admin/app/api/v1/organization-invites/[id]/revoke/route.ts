import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { isPrincipalOnlyDenial } from '@/lib/staffAuthorizationErrors';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/organization-invites/:id/revoke (owner + staff access completion pass, WORKLOG.md
 * this date). Thin wrapper over revoke_organization_invite() (migration 20260101000089), which
 * does all real authorization (manager+ org role).
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
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

  const { error } = await supabase.rpc('revoke_organization_invite', { p_invite_id: id });
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
