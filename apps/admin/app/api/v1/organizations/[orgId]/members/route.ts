import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * GET /api/v1/organizations/:orgId/members (shared-access architecture pass, WORKLOG.md this
 * date) -- the first real "who's on this team" listing; nothing read this table client-side
 * before (confirmed by grep). manager+ only, matching grant_property_access()'s own floor for
 * changing anyone's access.
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
      { error: { code: 'forbidden', message: 'You do not have permission to view staff access.' } },
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
  const { data: profiles } =
    userIds.length > 0
      ? await supabase.from('profiles').select('id, display_name').in('id', userIds)
      : { data: [] as { id: string; display_name: string | null }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const members = (data ?? []).map((m) => ({
    userId: m.user_id,
    role: m.role,
    propertyAccessMode: m.property_access_mode,
    joinedAt: m.joined_at,
    displayName: nameById.get(m.user_id) ?? null,
  }));

  return NextResponse.json({ members });
}
