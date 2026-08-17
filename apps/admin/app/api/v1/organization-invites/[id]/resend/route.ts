import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { dispatchEmail } from '@/lib/emailDispatch';
import { getAppUrl } from '@/lib/appUrl';
import { branding } from '@propvault/config';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/organization-invites/:id/resend (owner + staff access completion pass, WORKLOG.md
 * this date). organization_invites.token is stored plaintext (unlike owner_invitations' hashed
 * token -- a pre-existing, different design this route doesn't change), so a resend just
 * re-dispatches the same accept link rather than needing a regenerate RPC.
 */
export async function POST(request: NextRequest, params: RouteParams) {
  try {
    return await handlePOST(request, params);
  } catch (err) {
    console.error('[organization-invites/resend] unhandled error', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } },
      { status: 500 },
    );
  }
}

async function handlePOST(_request: NextRequest, { params }: RouteParams) {
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
    .select(
      'id, org_id, email, invitee_name, role, token, expires_at, accepted_at, revoked_at, resend_count',
    )
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

  // Overnight platform pass (WORKLOG.md this date): real bug found while diagnosing "staff
  // invitation resend never arrives" -- dispatchEmail() is idempotent on (related_entity_type,
  // related_entity_id, template_name), and this call previously reused the SAME relatedEntityId
  // (the bare invite id) the original creation call already consumed, so every resend was
  // silently absorbed by that same idempotency guard and never actually re-dispatched. A
  // resend-specific suffix (migration 20260101000091's resend_count) gives each resend its own
  // key, mirroring the pattern owner_invitations/tenant_invitations already use.
  const nextResendCount = invite.resend_count + 1;
  const { error: countError } = await supabase
    .from('organization_invites')
    .update({ resend_count: nextResendCount })
    .eq('id', id);
  if (countError) {
    return NextResponse.json(
      { error: { code: 'resend_count_update_failed', message: countError.message } },
      { status: 500 },
    );
  }

  const [{ data: org }, { data: inviterProfile }] = await Promise.all([
    supabase.from('organizations').select('legal_name').eq('id', invite.org_id).maybeSingle(),
    supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
  ]);
  const serviceClient = getServiceRoleClient();
  const dispatchResult = await dispatchEmail(serviceClient, {
    orgId: invite.org_id,
    toAddress: invite.email,
    toUserId: null,
    templateName: 'member_invited',
    templateVars: {
      orgName: org?.legal_name ?? `a ${branding.productName} organization`,
      role: invite.role,
      acceptUrl: `${getAppUrl()}/invitations/accept?token=${invite.token}`,
      inviterName: inviterProfile?.display_name ?? null,
      inviteeName: invite.invitee_name,
      expiresAt: new Date(invite.expires_at).toLocaleDateString('en-ZA'),
    },
    // related_entity_id is a real `uuid` column (email_messages, migration 20260101000040) -- it
    // must stay the invite's actual id, not a suffixed string. related_entity_type is plain
    // `text`, so the resend counter goes there instead: still a distinct idempotency key per
    // attempt, without needing a fabricated/derived uuid.
    relatedEntityType: `organization_invites:resend:${nextResendCount}`,
    relatedEntityId: invite.id,
    actorUserId: user.id,
  });

  return NextResponse.json({
    ok: true,
    emailDeliveryConfigured: dispatchResult.deliveryConfigured,
  });
}
