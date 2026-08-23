import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';

type RouteParams = { params: Promise<{ orgId: string; id: string }> };

/**
 * POST /api/v1/organizations/:orgId/staff-provisions/:id/revoke -- cancels a staff provision
 * BEFORE the employee has activated (status 'pending' / 'pending_send_failed' /
 * 'awaiting_activation'). Distinct from POST .../members/:userId/revoke (unchanged, still the
 * correct route for an already-activated staff member -- that RPC already handles "status becomes
 * revoked, property access cleared, auth user/audit history untouched" exactly as required).
 * No seat was ever consumed by a not-yet-activated provision, so there is nothing to free here --
 * this is purely "stop this invitation from being usable."
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { orgId, id } = await params;
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
      { error: { code: 'forbidden', message: 'You do not have permission to revoke this provision.' } },
      { status: 403 },
    );
  }

  const { data: provision, error: fetchError } = await supabase
    .from('organization_staff_provisions')
    .select('id, status')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'provision_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!provision) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Staff provision not found.' } },
      { status: 404 },
    );
  }
  if (provision.status === 'activated') {
    return NextResponse.json(
      {
        error: {
          code: 'already_activated',
          message:
            'This staff member has already activated their account. Use "Remove staff access" instead.',
        },
      },
      { status: 400 },
    );
  }
  if (provision.status === 'revoked') {
    return NextResponse.json({ ok: true });
  }

  // organization_staff_provisions has no direct UPDATE policy for `authenticated` (RPC-only
  // mutation, see the migration's own comment) -- the authorization check above (requireOrgRole)
  // is what actually gates this, so the write itself goes through the service-role client, same
  // split the resend route already uses.
  const serviceClient = getServiceRoleClient();
  const { error } = await serviceClient
    .from('organization_staff_provisions')
    .update({ status: 'revoked' })
    .eq('id', id);
  if (error) {
    return NextResponse.json(
      { error: { code: 'revoke_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
