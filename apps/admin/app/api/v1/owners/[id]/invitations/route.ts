import { NextResponse, type NextRequest } from 'next/server';
import { ownerInvitationCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { canUseOwnerPortal } from '@/lib/subscriptionEntitlements';
import { mapOwnerInvitationRow, maskDestination } from '@/lib/ownerInvitations';
import { dispatchEmail } from '@/lib/emailDispatch';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { getAppUrl } from '@/lib/appUrl';

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

export async function POST(request: NextRequest, params: RouteParams) {
  // Production incident fix (WORKLOG.md this date): guarantees a JSON response even if something
  // below throws instead of returning a Supabase {data,error} pair -- see the matching comment in
  // owners/[id]/link-self/route.ts for the full reasoning.
  try {
    return await handlePOST(request, params);
  } catch (err) {
    console.error('[owners/invitations] unhandled error', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } },
      { status: 500 },
    );
  }
}

async function handlePOST(request: NextRequest, { params }: RouteParams) {
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

  // RELEASE A P0 fix: the owner portal is a real, gated commercial differentiator
  // (feature_limits.ownerPortalEnabled) that was previously readable but never enforced anywhere.
  if (!(await canUseOwnerPortal(supabase, owner.org_id))) {
    return NextResponse.json(
      {
        error: {
          code: 'feature_not_available',
          message: 'The owner portal is not included in your current plan.',
          upgradeRequired: true,
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
  // Final pre-UAT engineering pass (WORKLOG.md this date), Part 15: same fix as the tenant
  // invitation route -- calls the single shared getAppUrl() helper instead of duplicating its
  // fallback logic inline.
  const acceptUrl = `${getAppUrl()}/owner-invitations/accept?token=${created.token}`;

  // WhatsApp delivery is not implemented for owner invitations yet -- doing so requires a
  // pre-approved WhatsApp Business template this codebase has no equivalent for (unlike
  // tenant_invitation's own approved template). 'whatsapp'/'manual' both still create a real,
  // valid invitation and return the accept link below; staff share it themselves in that case,
  // same "no dispatch, link only" behaviour tenant invitations already have for 'manual'.
  //
  // Overnight platform pass (WORKLOG.md this date): TWO root causes found for "invitation shows
  // pending but no email ever arrives":
  // 1) dispatchEmail() silently no-ops through MockEmailProvider whenever RESEND_API_KEY/
  //    RESEND_FROM_ADDRESS aren't set, and this route never surfaced that -- now reported to the
  //    caller as `emailDeliveryConfigured` rather than a fabricated "sent" outcome.
  // 2) A more serious, more fundamental bug: relatedEntityId below was previously
  //    `${created.invitation_id}:0` -- a string -- but email_messages.related_entity_id is a real
  //    `uuid` column (20260101000040), so dispatchEmail()'s own insert would throw "invalid input
  //    syntax for type uuid" and this whole request would fail with a 500 whenever an owner
  //    actually had an email on file (deliveryChannel: 'email' is exactly the UI's default for
  //    that case) -- confirmed against a real local database, not assumed. The ":0" suffix served
  //    no purpose: create_owner_invitation() already mints a fresh invitation_id (hence a fresh
  //    uuid) on every call (it revokes-then-recreates, there is no "resend the same invitation
  //    row" path for owners the way organization_invites has), so the bare uuid is already unique
  //    per dispatch with nothing to suffix.
  let emailDeliveryConfigured: boolean | null = null;
  if (parsed.data.deliveryChannel === 'email' && owner.email) {
    const dispatchResult = await dispatchEmail(serviceClient, {
      orgId: owner.org_id,
      toAddress: owner.email,
      templateName: 'owner_invitation',
      templateVars: {
        orgName: org?.legal_name,
        ownerName: owner.name,
        acceptUrl,
        expiresAt: new Date(created.expires_at).toLocaleDateString('en-ZA'),
      },
      relatedEntityType: 'owner_invitations',
      relatedEntityId: created.invitation_id,
      actorUserId: user.id,
    });
    emailDeliveryConfigured = dispatchResult.deliveryConfigured;
  }

  // The plaintext token is returned exactly once -- the API never logs it, the DB never stores
  // it (only its hash). The UI must show it to staff now or lose it forever.
  return NextResponse.json(
    {
      invitationId: created.invitation_id,
      emailDeliveryConfigured,
      token: created.token,
      expiresAt: created.expires_at,
      acceptUrl,
    },
    { status: 201 },
  );
}
