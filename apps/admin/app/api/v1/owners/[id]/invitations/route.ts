import { NextResponse, type NextRequest } from 'next/server';
import { ownerInvitationCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapOwnerInvitationRow, maskDestination } from '@/lib/ownerInvitations';
import { dispatchEmail } from '@/lib/emailDispatch';
import { rateLimitOrRespond } from '@/lib/rateLimit';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET/POST /api/v1/owners/:id/invitations (shared-access architecture pass, WORKLOG.md this
 * date) -- mirrors /api/v1/tenants/:id/invitations exactly. agent+ only. POST always issues a
 * fresh invitation (create_owner_invitation() already revokes any prior un-accepted one for the
 * same owner) -- one endpoint serves "Invite"/"Resend" both, same reasoning tenant invitations
 * document.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
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

  const { data, error } = await supabase
    .from('owner_invitations')
    .select('*')
    .eq('owner_id', id)
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: { code: 'owner_invitations_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ invitations: (data ?? []).map(mapOwnerInvitationRow) });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
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

  const limited = await rateLimitOrRespond(supabase, `owner-invitation-create:${user.id}`, 20, 60);
  if (limited) return limited;

  const { data: owner, error: ownerError } = await supabase
    .from('owners')
    .select('id, org_id, email, phone, name, user_id')
    .eq('id', id)
    .maybeSingle();
  if (ownerError) {
    return NextResponse.json(
      { error: { code: 'owner_fetch_failed', message: ownerError.message } },
      { status: 500 },
    );
  }
  if (!owner) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Owner not found.' } },
      { status: 404 },
    );
  }
  if (owner.user_id) {
    return NextResponse.json(
      {
        error: {
          code: 'already_linked',
          message: 'This owner is already linked to a Proplyst account.',
        },
      },
      { status: 409 },
    );
  }

  const canWrite = await requireOrgRole(supabase, owner.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to invite this owner.' } },
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

  const parsed = ownerInvitationCreateSchema.safeParse(body);
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

  const destination = owner.email;
  if (parsed.data.deliveryChannel === 'email' && !destination) {
    return NextResponse.json(
      {
        error: {
          code: 'no_destination',
          message: 'This owner has no email address on file.',
        },
      },
      { status: 400 },
    );
  }

  const { data: rpcRows, error: rpcError } = await supabase.rpc('create_owner_invitation', {
    p_owner_id: id,
    p_delivery_channel: parsed.data.deliveryChannel,
    p_destination_hint: destination ? maskDestination(destination) : null,
  });
  if (rpcError) {
    return NextResponse.json(
      { error: { code: 'owner_invitation_create_failed', message: rpcError.message } },
      { status: 500 },
    );
  }
  const created = rpcRows?.[0];
  if (!created) {
    return NextResponse.json(
      { error: { code: 'owner_invitation_create_failed', message: 'No invitation was created.' } },
      { status: 500 },
    );
  }

  const serviceClient = getServiceRoleClient();
  const { data: org } = await serviceClient
    .from('organizations')
    .select('legal_name')
    .eq('id', owner.org_id)
    .maybeSingle();
  const acceptUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/owner-invitations/accept?token=${created.token}`;

  // WhatsApp delivery is not implemented for owner invitations yet -- doing so requires a
  // pre-approved WhatsApp Business template this codebase has no equivalent for (unlike
  // tenant_invitation's own approved template). 'whatsapp'/'manual' both still create a real,
  // valid invitation and return the accept link below; staff share it themselves in that case,
  // same "no dispatch, link only" behaviour tenant invitations already have for 'manual'.
  if (parsed.data.deliveryChannel === 'email' && owner.email) {
    await dispatchEmail(serviceClient, {
      orgId: owner.org_id,
      toAddress: owner.email,
      templateName: 'owner_invitation',
      templateVars: { orgName: org?.legal_name, ownerName: owner.name, acceptUrl },
      relatedEntityType: 'owner_invitations',
      relatedEntityId: `${created.invitation_id}:0`,
      actorUserId: user.id,
    });
  }

  // The plaintext token is returned exactly once -- the API never logs it, the DB never stores
  // it (only its hash). The UI must show it to staff now or lose it forever.
  return NextResponse.json(
    { invitationId: created.invitation_id, token: created.token, expiresAt: created.expires_at, acceptUrl },
    { status: 201 },
  );
}
