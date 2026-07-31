import { NextResponse, type NextRequest } from 'next/server';
import { createOrganizationInviteSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';

type RouteParams = { params: Promise<{ orgId: string }> };

// A manager who can only rank strictly below `principal` must not be able to invite a peer or
// superior manager/principal — PERMISSIONS.md's role table: "manager: Invite/remove
// agent/accountant/viewer only". `has_org_role()`/RLS enforce "is this caller manager+ at all";
// this table enforces the finer "which roles can THIS caller's rank grant" rule RLS doesn't
// express (PERMISSIONS.md layer 2).
const MAX_INVITABLE_ROLE_FOR: Record<'principal' | 'manager', ReadonlySet<string>> = {
  principal: new Set(['manager', 'agent', 'accountant', 'viewer']),
  manager: new Set(['agent', 'accountant', 'viewer']),
};

/**
 * POST /api/v1/organizations/:orgId/invites (API_SPEC.md §2, TASKS.md M4). Closes a real gap
 * found during 2026-07-31 verification: `organization_invites` had a SELECT policy but no INSERT
 * policy (migration 20260101000026), and no route ever called it — the invitations flow was
 * schema-complete but not actually usable end-to-end.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

  const canInviteAtAll = await requireOrgRole(supabase, orgId, 'manager');
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

  const { data, error } = await supabase
    .from('organization_invites')
    .insert({
      org_id: orgId,
      email: parsed.data.email,
      role: parsed.data.role,
      invited_by: user.id,
    })
    .select('id, org_id, email, role, token, expires_at, created_at')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'invite_create_failed', message: error.message } },
      { status: 500 },
    );
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
    },
    { status: 201 },
  );
}
