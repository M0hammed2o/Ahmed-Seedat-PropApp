import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapTenantInvitationRow } from '@/lib/tenantInvitations';

type RouteParams = { params: Promise<{ id: string; invitationId: string }> };

/** POST /api/v1/tenants/:id/invitations/:invitationId/revoke -- agent+. Plain RLS-gated UPDATE
 *  (no RPC needed -- unlike acceptance, revocation has no multi-step invariant to keep atomic). */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { id, invitationId } = await params;
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

  const { data: invite, error: fetchError } = await supabase
    .from('tenant_invitations')
    .select('*')
    .eq('id', invitationId)
    .eq('tenant_id', id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'tenant_invitation_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!invite) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Invitation not found.' } }, { status: 404 });
  }

  const canWrite = await requireOrgRole(supabase, invite.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to revoke this invitation.' } },
      { status: 403 },
    );
  }

  if (invite.accepted_at) {
    return NextResponse.json(
      { error: { code: 'already_accepted', message: 'This invitation was already accepted and cannot be revoked.' } },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from('tenant_invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', invitationId)
    .select('*')
    .single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'tenant_invitation_revoke_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ invitation: mapTenantInvitationRow(data) });
}
