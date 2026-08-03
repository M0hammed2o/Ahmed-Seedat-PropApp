import Link from 'next/link';
import type { Property } from '@propvault/types';
import { PropertiesGridClient } from '@/components/properties/PropertiesGridClient';
import type { PropertyCardData } from '@/components/properties/PropertyCard';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapPropertyRow } from '@/lib/portfolio';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_PROPERTIES: Property[] = [
  {
    id: 'demo-property-1',
    orgId: 'demo-org-1',
    nickname: 'Sea Point Apartment',
    fullAddress: '12 Main Road, Sea Point, Cape Town, 8005',
    addressLine1: '12 Main Road',
    addressLine2: null,
    suburb: 'Sea Point',
    city: 'Cape Town',
    province: 'Western Cape',
    postalCode: '8005',
    country: 'ZA',
    propertyType: 'apartment',
    municipalAccountNumber: null,
    notes: null,
    imagePath: null,
    status: 'active',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  },
];

/**
 * GET /properties -- first page in the (dashboard) client-org-facing route group (TASKS.md M20).
 * Queries directly through the caller's own session-bound client, same "plain RLS-protected
 * read" pattern GET /api/v1/properties documents (RLS already scopes to the caller's org
 * memberships) -- no org_id filter applied here, which is correct for a single-org user and a
 * known, honest simplification for a multi-org user (shows properties across every org they
 * belong to, combined) until an org switcher exists.
 */
const DEMO_CARDS: PropertyCardData[] = [
  {
    id: 'demo-property-1',
    nickname: 'Sea Point Apartment',
    fullAddress: '12 Main Road, Sea Point, Cape Town, 8005',
    city: 'Cape Town',
    propertyType: 'apartment',
    status: 'active',
    imagePath: null,
    unitsCount: 1,
    occupiedCount: 1,
    monthlyIncome: 12500,
    outstanding: 0,
  },
];

export default async function PropertiesPage() {
  const properties: Property[] = ADMIN_DEMO_MODE ? DEMO_PROPERTIES : await loadProperties();
  const cards: PropertyCardData[] = ADMIN_DEMO_MODE ? DEMO_CARDS : await loadPropertyCards(properties);

  const addAction = (
    <Link href="/properties/new">
      <Button variant="primary" size="sm">
        + Add property
      </Button>
    </Link>
  );

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Properties"
        subtitle={`${properties.length} ${properties.length === 1 ? 'property' : 'properties'} in your portfolio.`}
        actions={properties.length > 0 ? addAction : undefined}
      />
      <PropertiesGridClient cards={cards} tableData={properties} emptyAction={addAction} />
    </div>
  );
}

async function loadProperties(): Promise<Property[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load properties: ${error.message}`);
  return (data ?? []).map(mapPropertyRow);
}

// Real per-property aggregates for the card grid (UI_INTEGRATION_PLAN.md) -- units/occupancy from
// `units`, monthly income from active leases' real rent_amount (not the unit's market_rent
// estimate), outstanding from rent_schedules rows not yet paid. Three flat queries + client-side
// grouping, matching this codebase's existing join style (e.g. leases/page.tsx), rather than a
// deep nested PostgREST embed.
async function loadPropertyCards(properties: Property[]): Promise<PropertyCardData[]> {
  if (properties.length === 0) return [];
  const supabase = await getServerSupabaseClient();
  const propertyIds = properties.map((p) => p.id);

  const [unitsResult, leasesResult] = await Promise.all([
    supabase.from('units').select('id, property_id, status').in('property_id', propertyIds),
    supabase.from('leases').select('id, unit_id, rent_amount, status'),
  ]);
  if (unitsResult.error) throw new Error(`Failed to load units: ${unitsResult.error.message}`);
  if (leasesResult.error) throw new Error(`Failed to load leases: ${leasesResult.error.message}`);

  const units = unitsResult.data ?? [];
  const unitPropertyById = new Map(units.map((u) => [u.id, u.property_id]));
  const activeLeases = (leasesResult.data ?? []).filter((l) => l.status === 'active');
  const activeLeaseIds = activeLeases.map((l) => l.id);

  const { data: rentSchedules, error: rentError } =
    activeLeaseIds.length > 0
      ? await supabase.from('rent_schedules').select('lease_id, amount, status').in('lease_id', activeLeaseIds)
      : { data: [], error: null };
  if (rentError) throw new Error(`Failed to load rent schedule: ${rentError.message}`);

  const leaseByUnit = new Map(activeLeases.map((l) => [l.unit_id, l]));

  const outstandingByProperty = new Map<string, number>();
  const leasePropertyById = new Map(activeLeases.map((l) => [l.id, unitPropertyById.get(l.unit_id)]));
  for (const r of rentSchedules ?? []) {
    if (r.status !== 'invoiced' && r.status !== 'overdue' && r.status !== 'partial') continue;
    const propId = leasePropertyById.get(r.lease_id);
    if (!propId) continue;
    outstandingByProperty.set(propId, (outstandingByProperty.get(propId) ?? 0) + Number(r.amount));
  }

  return properties.map((property) => {
    const propertyUnits = units.filter((u) => u.property_id === property.id);
    const occupiedCount = propertyUnits.filter((u) => u.status === 'occupied').length;
    const monthlyIncome = propertyUnits.reduce((sum, u) => sum + Number(leaseByUnit.get(u.id)?.rent_amount ?? 0), 0);
    return {
      id: property.id,
      nickname: property.nickname,
      fullAddress: property.fullAddress,
      city: property.city,
      propertyType: property.propertyType,
      status: property.status,
      imagePath: property.imagePath,
      unitsCount: propertyUnits.length,
      occupiedCount,
      monthlyIncome,
      outstanding: outstandingByProperty.get(property.id) ?? 0,
    };
  });
}
