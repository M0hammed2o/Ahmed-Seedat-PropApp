import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Property } from '@propvault/types';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapPropertyRow, mapUnitRow } from '@/lib/portfolio';
import { resolvePortalSession, findActiveMembership } from '@/lib/orgSession';
import { UnitsTable, type UnitRow } from '@/components/tables/UnitsTable';
import { Button } from '@/components/ui/Button';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

const DEMO_PROPERTY: Property = {
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
};

const DEMO_UNITS: UnitRow[] = [
  {
    id: 'demo-unit-1',
    propertyId: 'demo-property-1',
    orgId: 'demo-org-1',
    unitLabel: 'Unit 1',
    bedrooms: 2,
    bathrooms: 1,
    sizeSqm: 65,
    marketRent: 12500,
    status: 'occupied',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  },
];

export default async function PropertyDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-property-1') notFound();
    return <PropertyDetailView property={DEMO_PROPERTY} units={DEMO_UNITS} canManageUnits />;
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('properties').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load property: ${error.message}`);
  if (!data) notFound();
  const property = mapPropertyRow(data);

  const { data: unitRows, error: unitsError } = await supabase
    .from('units')
    .select('*')
    .eq('property_id', id)
    .order('unit_label', { ascending: true });
  if (unitsError) throw new Error(`Failed to load units: ${unitsError.message}`);
  const units: UnitRow[] = (unitRows ?? []).map(mapUnitRow);

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, property.orgId) : undefined;
  const canManageUnits = Boolean(membership && membership.role !== 'viewer' && membership.role !== 'accountant');

  return <PropertyDetailView property={property} units={units} canManageUnits={canManageUnits} />;
}

function PropertyDetailView({
  property,
  units,
  canManageUnits,
}: {
  property: Property;
  units: UnitRow[];
  canManageUnits: boolean;
}) {
  const addUnitAction = (
    <Link href={`/properties/${property.id}/units/new`}>
      <Button variant="primary" size="sm">
        + Add unit
      </Button>
    </Link>
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">{property.nickname}</h1>
        <span className="text-xs font-medium capitalize text-light-textSecondary dark:text-dark-textSecondary">
          {property.status}
        </span>
      </div>
      <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">{property.fullAddress}</p>

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Type</dt>
          <dd className="capitalize text-light-textPrimary dark:text-dark-textPrimary">
            {property.propertyType.replace('_', ' ')}
          </dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">City</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">{property.city}</dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Province</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">{property.province ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Municipal account</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            {property.municipalAccountNumber ?? '—'}
          </dd>
        </div>
      </dl>

      {property.notes ? (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">Notes</h2>
          <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">{property.notes}</p>
        </div>
      ) : null}

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
            Units ({units.length})
          </h2>
          {canManageUnits && units.length > 0 ? addUnitAction : null}
        </div>
        <div className="mt-3">
          <UnitsTable data={units} emptyAction={canManageUnits ? addUnitAction : undefined} />
        </div>
      </div>

      <p className="mt-8 text-xs text-light-textMuted dark:text-dark-textMuted">
        Leases, tenants, and maintenance for this property are built at the API layer (TASKS.md
        M8-M13) but not yet wired into this page — Units is the current vertical slice, the same
        pattern is repeated for those modules next.
      </p>
    </div>
  );
}
