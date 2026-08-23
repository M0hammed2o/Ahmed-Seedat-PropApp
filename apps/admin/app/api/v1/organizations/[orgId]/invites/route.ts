import { NextResponse, type NextRequest } from 'next/server';
import { createOrganizationInviteSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { getOrgSeatSummary, canInviteStaff } from '@/lib/subscriptionEntitlements';
import { dispatchEmail } from '@/lib/emailDispatch';
import { getAppUrl } from '@/lib/appUrl';
import { branding } from '@propvault/config';

type RouteParams = { params: Promise<{ orgId: string }> };

// Staff security + audit hardening pass (this date): staff administration -- including this
// legacy self-service invite flow -- is principal-only now (was manager+, PERMISSIONS.md's older
// "manager: Invite/remove agent/accountant/viewer only" row). The `manager` entry below is kept
// (not deleted) purely as historical/defensive shape -- `requireOrgRole(..., 'principal')` below
// already means a manager caller never reaches this lookup at all, but keeping the type honest
// about every role rather than narrowing it to a single key avoids a silent crash if this route's
// own floor is ever loosened again without updating this table to match.
const MAX_INVITABLE_ROLE_FOR: Record<'principal' | 'manager', ReadonlySet<string>> = {
  principal: new Set(['manager', 'agent', 'accountant', 'viewer']),
  manager: new Set(['agent', 'accountant', 'viewer']),
};

/**
 * GET /api/v1/organizations/:orgId/invites (owner + staff access completion pass, WORKLOG.md this
 * date; principal-only, staff security + audit hardening pass, this date) -- pending invites for
 * the Staff & property access screen. Principal-only, same floor as everything else about who may
 * see/manage staff (was manager+).
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

  const canManage = await requireOrgRole(supabase, orgId, 'principal');
  if (!canManage) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to view invitations.' } },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('organization_invites')
    .select(
      'id, org_id, email, invitee_name, role, property_access_mode, expires_at, accepted_at, revoked_at, created_at',
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: { code: 'invites_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  const invites = (data ?? []).map((row) => ({
    id: row.id,
    orgId: row.org_id,
    email: row.email,
    name: row.invitee_name,
    role: row.role,
    propertyAccessMode: row.property_access_mode,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ invites });
}

/**
 * POST /api/v1/organizations/:orgId/invites (API_SPEC.md §2, TASKS.md M4). Closes a real gap
 * found during 2026-07-31 verification: `organization_invites` had a SELECT policy but no INSERT
 * policy (migration 20260101000026), and no route ever called it — the invitations flow was
 * schema-complete but not actually usable end-to-end.
 */
export async function POST(request: NextRequest, params: RouteParams) {
  // Production incident fix (WORKLOG.md this date): guarantees a JSON response even if something
  // below throws instead of returning a Supabase {data,error} pair -- see the matching comment in
  // owners/[id]/link-self/route.ts for the full reasoning.
  try {
    return await handlePOST(request, params);
  } catch (err) {
    console.error('[organizations/invites] unhandled error', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } },
      { status: 500 },
    );
  }
}

async function handlePOST(request: NextRequest, { params }: RouteParams) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = createOrganizationInviteSchema.safeParse(body);
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

  const canInviteAtAll = await requireOrgRole(supabase, orgId, 'principal');
  if (!canInviteAtAll) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to invite members to this organization.',
        },
      },
      { status: 403 },
    );
  }

  // Owner subscription + staff seat entitlement architecture (WORKLOG.md this date): a paid seat
  // answers "is this org allowed to add another billable staff member," a separate question from
  // role/property permissions (which the checks further below still answer). Friendlier message
  // here; organization_invites' own INSERT policy (migration 20260101000094) re-checks this and
  // is the actual, unbypassable enforcement -- this pre-check exists so a real seat-limit hit
  // returns a clear, structured response instead of a bare RLS-violation 500.
  const seatSummary = await getOrgSeatSummary(supabase, orgId);
  if (!canInviteStaff(seatSummary)) {
    return NextResponse.json(
      {
        error: {
          code: 'staff_seat_limit_reached',
          message: `This organization has used all ${seatSummary.seatLimit} of its available staff seats. Add another seat to your subscription to invite more staff.`,
        },
      },
      { status: 402 },
    );
  }

  const { data: membership, error: membershipError } = await supabase
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json(
      { error: { code: 'membership_fetch_failed', message: membershipError.message } },
      { status: 500 },
    );
  }

  const inviterRole = membership?.role as 'principal' | 'manager' | undefined;
  const allowedRoles = inviterRole ? MAX_INVITABLE_ROLE_FOR[inviterRole] : undefined;
  if (!allowedRoles || !allowedRoles.has(parsed.data.role)) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: `A ${inviterRole ?? 'this'} cannot invite a member with the '${parsed.data.role}' role.`,
        },
      },
      { status: 403 },
    );
  }

  if (
    parsed.data.propertyAccessMode === 'selected' &&
    parsed.data.selectedProperties.length === 0
  ) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Select at least one property, or choose All properties.',
          field_errors: { selectedProperties: ['Select at least one property.'] },
        },
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('organization_invites')
    .insert({
      org_id: orgId,
      email: parsed.data.email,
      role: parsed.data.role,
      invited_by: user.id,
      invitee_name: parsed.data.name || null,
      property_access_mode: parsed.data.propertyAccessMode,
    })
    .select('id, org_id, email, role, token, expires_at, created_at')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'invite_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  if (parsed.data.propertyAccessMode === 'selected') {
    const { error: propsError } = await supabase.from('organization_invite_properties').insert(
      parsed.data.selectedProperties.map((sp) => ({
        invite_id: data.id,
        property_id: sp.propertyId,
        property_role: sp.propertyRole,
      })),
    );
    if (propsError) {
      // Roll back the invite itself rather than leave a half-configured "selected" invite with
      // zero properties attached -- the same failure mode the pre-flight check above exists to
      // prevent, just reached via a race/RLS edge instead of an empty array.
      await supabase.from('organization_invites').delete().eq('id', data.id);
      return NextResponse.json(
        { error: { code: 'invite_properties_failed', message: propsError.message } },
        { status: 500 },
      );
    }
  }

  // EMAIL.md §1's "Team — Invite a team member" catalogue entry (evidenced,
  // PROPVIEW_SCREENSHOT_AUDIT.md line 637). Best-effort: an email failure must not fail invite
  // creation itself — the invite row (and its token) is the source of truth; the admin can always
  // re-share the link manually if the email never arrives. toUserId is null since the invitee has
  // no account yet.
  const [{ data: org }, { data: inviterProfile }] = await Promise.all([
    supabase.from('organizations').select('legal_name').eq('id', orgId).maybeSingle(),
    supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
  ]);
  const serviceClient = getServiceRoleClient();
  // Overnight platform pass (WORKLOG.md this date): root cause of "staff invitation shows pending
  // but no email ever arrives" -- this swallowed every outcome, success or failure, identically,
  // so a MockEmailProvider no-op (RESEND_API_KEY/RESEND_FROM_ADDRESS unset) was indistinguishable
  // from a real send. Now captures and returns `emailDeliveryConfigured`; a genuine dispatch
  // error is still non-fatal to invite creation (the row/token remain the source of truth,
  // shareable manually) but is now at least logged instead of silently disappearing.
  let emailDeliveryConfigured: boolean | null = null;
  try {
    const dispatchResult = await dispatchEmail(serviceClient, {
      orgId,
      toAddress: data.email,
      toUserId: null,
      templateName: 'member_invited',
      templateVars: {
        orgName: org?.legal_name ?? `a ${branding.productName} organization`,
        role: data.role,
        acceptUrl: `${getAppUrl()}/invitations/accept?token=${data.token}`,
        inviterName: inviterProfile?.display_name ?? null,
        inviteeName: parsed.data.name || null,
        expiresAt: new Date(data.expires_at).toLocaleDateString('en-ZA'),
      },
      relatedEntityType: 'organization_invites',
      relatedEntityId: data.id,
      actorUserId: user.id,
    });
    emailDeliveryConfigured = dispatchResult.deliveryConfigured;
  } catch (err) {
    console.error('[organizations/invites] email dispatch failed', err);
  }

  return NextResponse.json(
    {
      invite: {
        id: data.id,
        orgId: data.org_id,
        email: data.email,
        role: data.role,
        token: data.token,
        expiresAt: data.expires_at,
        createdAt: data.created_at,
      },
      emailDeliveryConfigured,
    },
    { status: 201 },
  );
}
