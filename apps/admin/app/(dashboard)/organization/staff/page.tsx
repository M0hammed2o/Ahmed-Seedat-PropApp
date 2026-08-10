import { PageHeader } from '@/components/ui/PageHeader';
import { PermissionDenied } from '@/components/ui/PermissionDenied';
import { StaffAccessPanel } from '@/components/organizations/StaffAccessPanel';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

// Shared-access architecture pass (WORKLOG.md this date), Phase 3/6: the first UI for
// property-scoped staff access -- grant_property_access()/revoke_property_access()/
// set_member_property_access_mode() all already existed as RPCs (migration 20260101000063/084)
// with no page calling them (confirmed by grep). manager+ gate, same floor those RPCs themselves
// enforce.
export default async function OrganizationStaffPage() {
  if (ADMIN_DEMO_MODE) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader
          title="Staff & property access"
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
        <PageHeader title="Staff & property access" />
        <PermissionDenied message="Sign in required." />
      </div>
    );
  }
  if (activeOrg.role !== 'principal' && activeOrg.role !== 'manager') {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Staff & property access" />
        <PermissionDenied message="Only a manager or principal can manage staff property access." />
      </div>
    );
  }

  const supabase = await getServerSupabaseClient();
  const { data: properties, error } = await supabase
    .from('properties')
    .select('id, nickname')
    .eq('org_id', activeOrg.orgId)
    .order('nickname', { ascending: true });
  if (error) throw new Error(`Failed to load properties: ${error.message}`);

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Staff & property access"
        subtitle="Control which properties each team member can see and manage."
      />
      <StaffAccessPanel
        orgId={activeOrg.orgId}
        properties={properties ?? []}
        callerRole={activeOrg.role as 'principal' | 'manager'}
      />
    </div>
  );
}
