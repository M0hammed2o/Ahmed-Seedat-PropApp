import { redirect } from 'next/navigation';
import { NewApplicationPicker } from '@/components/applications/NewApplicationPicker';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type SearchParams = { searchParams: Promise<{ propertyId?: string }> };

/**
 * GET /applications/new (V1 launch-completion pass, Section 1/2: portfolio-level AND
 * property-level "+ New application" share this one picker, reached either bare (portfolio
 * Applications page) or with ?propertyId= pre-selected (a property's own Applications tab) --
 * property/unit selection happens here; actual creation is entirely handed off to the existing
 * ApplicationForm/POST /api/v1/applications, unchanged, so there is exactly one application
 * creation code path regardless of entry point.
 */
export default async function NewApplicationPortfolioPage({ searchParams }: SearchParams) {
  const { propertyId } = await searchParams;

  if (ADMIN_DEMO_MODE) {
    return (
      <NewApplicationPicker
        orgId="demo-org-1"
        properties={[{ id: 'demo-property-1', nickname: 'Sea Point Apartment' }]}
        units={[
          {
            id: 'demo-unit-1',
            propertyId: 'demo-property-1',
            unitLabel: 'Unit 1',
            marketRent: 12500,
          },
        ]}
        initialPropertyId={propertyId ?? null}
      />
    );
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) redirect('/onboarding/create-organization');
  const membership = findActiveMembership(session, activeOrg.orgId);
  if (!membership || !canWriteOrgRecords(membership.role)) redirect('/applications');

  const supabase = await getServerSupabaseClient();
  const [propertiesResult, unitsResult] = await Promise.all([
    supabase
      .from('properties')
      .select('id, nickname')
      .eq('org_id', activeOrg.orgId)
      .eq('status', 'active')
      .order('nickname', { ascending: true }),
    // Eligible/vacant only (spec: "Choose eligible/vacant unit") -- an occupied unit isn't a real
    // choice here; a landlord accepting applications for a unit mid-tenancy is not a V1 scenario.
    supabase
      .from('units')
      .select('id, property_id, unit_label, market_rent')
      .eq('org_id', activeOrg.orgId)
      .eq('status', 'vacant')
      .order('unit_label', { ascending: true }),
  ]);
  if (propertiesResult.error)
    throw new Error(`Failed to load properties: ${propertiesResult.error.message}`);
  if (unitsResult.error) throw new Error(`Failed to load units: ${unitsResult.error.message}`);

  return (
    <NewApplicationPicker
      orgId={activeOrg.orgId}
      properties={propertiesResult.data ?? []}
      units={(unitsResult.data ?? []).map((u) => ({
        id: u.id,
        propertyId: u.property_id,
        unitLabel: u.unit_label,
        marketRent: u.market_rent,
      }))}
      initialPropertyId={propertyId ?? null}
    />
  );
}
