import { NextResponse, type NextRequest } from 'next/server';
import { provisionStaffMemberSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { provisionStaffMember } from '@/lib/staffProvisioning';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * GET /api/v1/organizations/:orgId/staff-provisions -- provisioned-staff rows for the
 * Organization -> Staff screen (alongside the still-separate, still-untouched
 * GET .../invites listing for any legacy self-service invitation). Manager+ only, same floor as
 * every other staff-management read.
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

  const canManage = await requireOrgRole(supabase, orgId, 'manager');
  if (!canManage) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to view staff provisions.' } },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('organization_staff_provisions')
    .select(
      'id, org_id, email, full_name, role, property_access_mode, status, expires_at, activated_at, resend_count, created_at',
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: { code: 'staff_provisions_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  const provisions = (data ?? []).map((row) => ({
    id: row.id,
    orgId: row.org_id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    propertyAccessMode: row.property_access_mode,
    // 'expired' is derived at read time, matching organization_invites' own established
    // convention (no stored 'expired' status value there either) -- a stored status would need a
    // background job to keep in sync with the clock; a computed one never can drift.
    status:
      row.status === 'awaiting_activation' && new Date(row.expires_at) < new Date()
        ? 'expired'
        : row.status,
    expiresAt: row.expires_at,
    activatedAt: row.activated_at,
    resendCount: row.resend_count,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ provisions });
}

/**
 * POST /api/v1/organizations/:orgId/staff/provision (Organization -> Staff -> "Add staff
 * member"). Thin wrapper -- provision_staff_member() (migration 20260101000124) owns every
 * authorization/seat/role-ceiling/membership/property-access decision; this route only validates
 * the request shape and hands off to lib/staffProvisioning.ts for the GoTrue Admin API + email
 * steps the RPC structurally cannot perform itself.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    return await handlePOST(request, params);
  } catch (err) {
    console.error('[organizations/staff-provisions] unhandled error', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } },
      { status: 500 },
    );
  }
}

async function handlePOST(request: NextRequest, params: RouteParams['params']) {
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

  const parsed = provisionStaffMemberSchema.safeParse(body);
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

  const serviceClient = getServiceRoleClient();

  try {
    const result = await provisionStaffMember(supabase, serviceClient, user.id, {
      orgId,
      email: parsed.data.email,
      fullName: parsed.data.fullName ?? null,
      role: parsed.data.role,
      propertyAccessMode: parsed.data.propertyAccessMode,
      selectedProperties: parsed.data.selectedProperties,
    });

    return NextResponse.json(
      {
        provisionId: result.provisionId,
        isExistingActiveUser: result.isExistingActiveUser,
        membershipActivated: result.membershipActivated,
        emailDeliveryConfigured: result.emailDeliveryConfigured,
        emailOutcome: result.emailOutcome,
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to provision staff member.';
    if (message.startsWith('staff_seat_limit_reached')) {
      return NextResponse.json(
        {
          error: {
            code: 'staff_seat_limit_reached',
            message:
              'This organization has no remaining staff seats available. Add a seat to your subscription, or free one up, then try again.',
          },
        },
        { status: 402 },
      );
    }
    if (message.startsWith('org_not_commercially_active')) {
      return NextResponse.json(
        {
          error: {
            code: 'org_not_commercially_active',
            message: 'Complete billing setup before adding staff.',
          },
        },
        { status: 402 },
      );
    }
    if (message.includes('Only manager+') || message.includes('cannot provision a member')) {
      return NextResponse.json({ error: { code: 'forbidden', message } }, { status: 403 });
    }
    if (message.includes('Principal cannot be assigned')) {
      return NextResponse.json({ error: { code: 'forbidden', message } }, { status: 403 });
    }
    return NextResponse.json(
      { error: { code: 'provision_failed', message } },
      { status: 500 },
    );
  }
}
