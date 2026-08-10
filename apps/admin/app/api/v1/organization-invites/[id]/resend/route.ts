import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { dispatchEmail } from '@/lib/emailDispatch';
import { getAppUrl } from '@/lib/appUrl';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/organization-invites/:id/resend (owner + staff access completion pass, WORKLOG.md
 * this date). organization_invites.token is stored plaintext (unlike owner_invitations' hashed
 * token -- a pre-existing, different design this route doesn't change), so a resend just
 * re-dispatches the same accept link rather than needing a regenerate RPC.
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

  const { data: invite, error: fetchError } = await supabase
    .from('organization_invites')
    .select('id, org_id, email, invitee_name, role, token, expires_at, accepted_at, revoked_at')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'invite_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!invite) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Invitation not found.' } },
      { status: 404 },
    );
  }
  if (invite.accepted_at || invite.revoked_at) {
    return NextResponse.json(
      { error: { code: 'invite_inactive', message: 'This invitation is no longer pending.' } },
      { status: 400 },
    );
  }

  const canManage = await requireOrgRole(supabase, invite.org_id, 'manager');
  if (!canManage) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to resend this invitation.',
        },
      },
      { status: 403 },
    );
  }

  const [{ data: org }, { data: inviterProfile }] = await Promise.all([
    supabase.from('organizations').select('legal_name').eq('id', invite.org_id).maybeSingle(),
    supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
  ]);
  const serviceClient = getServiceRoleClient();
  await dispatchEmail(serviceClient, {
    orgId: invite.org_id,
    toAddress: invite.email,
    toUserId: null,
    templateName: 'member_invited',
    templateVars: {
      orgName: org?.legal_name ?? 'a PropertyVault organization',
      role: invite.role,
      acceptUrl: `${getAppUrl()}/invitations/accept?token=${invite.token}`,
      inviterName: inviterProfile?.display_name ?? null,
      inviteeName: invite.invitee_name,
      expiresAt: new Date(invite.expires_at).toLocaleDateString('en-ZA'),
    },
    relatedEntityType: 'organization_invites',
    relatedEntityId: invite.id,
    actorUserId: user.id,
  });

  return NextResponse.json({ ok: true });
}
