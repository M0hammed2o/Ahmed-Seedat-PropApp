import { PageHeader } from '@/components/ui/PageHeader';
import { PermissionDenied } from '@/components/ui/PermissionDenied';
import { StaffAccessPanel } from '@/components/organizations/StaffAccessPanel';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { getOrgSeatSummary } from '@/lib/subscriptionEntitlements';

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
  // Staff security + audit hardening pass (this date): a real production walkthrough showed a
  // Manager reaching this page and administering staff -- not permitted under the V1 permission
  // model. Staff & Property Access is Principal-only (was principal-or-manager); a Manager's own
  // operational abilities elsewhere (properties/tenants/leases, via property_access) are entirely
  // unaffected -- only STAFF ADMINISTRATION itself moved to principal-only, everywhere: this page
  // gate, every staff-provisions/members/property-access API route, and the underlying RPCs/RLS
  // (migration 20260101000125).
  if (activeOrg.role !== 'principal') {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Staff & property access" />
        <PermissionDenied message="Only the organization principal can manage staff and property access." />
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

  // Owner subscription + staff seat entitlement architecture (WORKLOG.md this date): a staff
  // seat belongs to the SUBSCRIBING ORGANIZATION, never the staff member -- only the principal
  // (who can already see this whole page) ever sees seat/billing information, per "do not expose
  // internal billing complexity to staff users."
  const seatSummary = await getOrgSeatSummary(supabase, activeOrg.orgId);

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Staff & property access"
        subtitle="Control which properties each team member can see and manage."
      />
      <StaffAccessPanel
        orgId={activeOrg.orgId}
        properties={properties ?? []}
        seatSummary={seatSummary}
      />
    </div>
  );
}
