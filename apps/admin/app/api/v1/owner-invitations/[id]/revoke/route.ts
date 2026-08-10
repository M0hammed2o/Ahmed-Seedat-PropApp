import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/owner-invitations/:id/revoke -- mirrors tenants' own revoke endpoint. Authorization
 * (agent+ on the invitation's org) is enforced inside revoke_owner_invitation() itself. */
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

  const { error } = await supabase.rpc('revoke_owner_invitation', { p_invitation_id: id });
  if (error) {
    return NextResponse.json(
      { error: { code: 'owner_invitation_revoke_failed', message: error.message } },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
