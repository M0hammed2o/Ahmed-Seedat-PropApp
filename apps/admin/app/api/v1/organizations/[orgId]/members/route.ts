import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * GET /api/v1/organizations/:orgId/members (shared-access architecture pass, WORKLOG.md this
 * date; principal-only + name-resolution fix, staff security + audit hardening pass, this date).
 * Principal-only now, matching every other staff-administration surface (was manager+).
 *
 * Real bug found and fixed this pass (root cause of the raw-UUID-in-the-staff-list production
 * screenshots): `profiles` has only ONE SELECT policy, `profiles_select_own` (`id = auth.uid()`)
 * -- it was NEVER relaxed for same-org visibility. The previous version of this route queried
 * `profiles` with the session client, so RLS silently returned zero rows for every teammate
 * except the caller's own, and every other member's name resolved to `null` -- StaffAccessPanel's
 * `m.displayName ?? m.userId` fallback then rendered the raw auth UUID for everyone else, exactly
 * what the screenshots showed, symmetrically (a Manager saw the Principal's UUID and vice versa).
 * Fixed by resolving names via the service-role client instead -- this route's own
 * `requireOrgRole` check above is already the authorization boundary, same pattern already used
 * throughout this codebase (e.g. staff-provisions routes) for an elevated read after an
 * app-layer authorization check, rather than widening `profiles`' own RLS (which would let ANY
 * authenticated same-org member query teammates' profiles directly over PostgREST, including
 * columns this route never even selects, e.g. `phone_e164`).
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
      {
        error: {
          code: 'forbidden',
          message: 'Only the organization principal can view staff access.',
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('organization_members')
    .select('user_id, role, status, property_access_mode, joined_at')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('joined_at', { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: { code: 'members_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  const userIds = (data ?? []).map((m) => m.user_id);
  const serviceClient = getServiceRoleClient();
  const { data: profiles } =
    userIds.length > 0
      ? await serviceClient.from('profiles').select('id, display_name').in('id', userIds)
      : { data: [] as { id: string; display_name: string | null }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  // Fallback hierarchy (item 5): completed profile name -> email -> "Unnamed user". Never the raw
  // UUID. Email is fetched only for members whose profile has no display_name, via the Admin API
  // (never exposed to a client that couldn't already see it -- this route is principal-only).
  const missingNameIds = userIds.filter((id) => !nameById.get(id));
  const emailById = new Map<string, string | null>();
  if (missingNameIds.length > 0) {
    await Promise.all(
      missingNameIds.map(async (id) => {
        const { data: authUser } = await serviceClient.auth.admin.getUserById(id);
        emailById.set(id, authUser.user?.email ?? null);
      }),
    );
  }

  // Property count for the "5 properties" style summary (staff management UX, WORKLOG.md this
  // date) -- only meaningful for 'selected' mode; 'all' mode members show "All properties" in the
  // UI regardless of this number.
  const { data: accessRows } =
    userIds.length > 0
      ? await supabase
          .from('property_access')
          .select('user_id, properties!inner(org_id)')
          .in('user_id', userIds)
          .eq('properties.org_id', orgId)
      : { data: [] as { user_id: string }[] };
  const propertyCountByUser = new Map<string, number>();
  for (const row of accessRows ?? []) {
    propertyCountByUser.set(row.user_id, (propertyCountByUser.get(row.user_id) ?? 0) + 1);
  }

  const members = (data ?? []).map((m) => ({
    userId: m.user_id,
    role: m.role,
    propertyAccessMode: m.property_access_mode,
    joinedAt: m.joined_at,
    displayName: nameById.get(m.user_id) || emailById.get(m.user_id) || 'Unnamed user',
    propertyCount: propertyCountByUser.get(m.user_id) ?? 0,
  }));

  return NextResponse.json({ members });
}
