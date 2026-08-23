import { PageHeader } from '@/components/ui/PageHeader';
import { PermissionDenied } from '@/components/ui/PermissionDenied';
import { ActivityLogClient } from '@/components/organizations/ActivityLogClient';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { resolvePortalSession } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

/**
 * GET /organization/activity (item 4, staff security + audit hardening pass, this date) --
 * Principal-only, matching Staff & property access and Billing. Loads the two filter option
 * lists (staff roster, properties) server-side; the activity feed itself is fetched client-side
 * from GET /api/v1/organizations/:orgId/activity so filter changes don't need a full page nav.
 */
export default async function OrganizationActivityPage() {
  if (ADMIN_DEMO_MODE) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader
          title="Activity"
          subtitle="Not available in demo mode -- requires a live Supabase project."
        />
      </div>
    );
  }

  const session = await resolvePortalSession();
  const activeOrg = session?.organizations.find((m) => m.status === 'active');
  if (!session || !activeOrg) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Activity" />
        <PermissionDenied message="Sign in required." />
      </div>
    );
  }
  if (activeOrg.role !== 'principal') {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Activity" />
        <PermissionDenied message="Only the organization principal can view the organisation activity log." />
      </div>
    );
  }

  const supabase = await getServerSupabaseClient();
  const [{ data: members }, { data: properties }] = await Promise.all([
    supabase
      .from('organization_members')
      .select('user_id, role, status')
      .eq('org_id', activeOrg.orgId)
      .eq('status', 'active'),
    supabase
      .from('properties')
      .select('id, nickname')
      .eq('org_id', activeOrg.orgId)
      .order('nickname', { ascending: true }),
  ]);

  // Same name-resolution fix as members/route.ts -- profiles' own SELECT policy is own-row-only,
  // so cross-member name lookups must go through the service-role client after this page's own
  // principal-only gate above, not the session client.
  const userIds = (members ?? []).map((m) => m.user_id);
  const serviceClient = getServiceRoleClient();
  const { data: profiles } =
    userIds.length > 0
      ? await serviceClient.from('profiles').select('id, display_name').in('id', userIds)
      : { data: [] as { id: string; display_name: string | null }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const staffOptions = (members ?? []).map((m) => ({
    userId: m.user_id,
    label: nameById.get(m.user_id) || 'Unnamed user',
  }));

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Activity"
        subtitle="Every recorded change your team has made, who made it, and when."
      />
      <ActivityLogClient
        orgId={activeOrg.orgId}
        staffOptions={staffOptions}
        properties={(properties ?? []).map((p) => ({ id: p.id, nickname: p.nickname }))}
      />
    </div>
  );
}
