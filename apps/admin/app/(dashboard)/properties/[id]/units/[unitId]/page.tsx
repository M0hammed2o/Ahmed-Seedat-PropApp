import Link from 'next/link';
import { notFound } from 'next/navigation';
import { UNIT_STATUS_PRESENTATION } from '@propvault/ui';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapUnitRow } from '@/lib/portfolio';
import { mapLeaseRow } from '@/lib/leasing';
import { resolvePortalSession, findActiveMembership } from '@/lib/orgSession';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { LeasesTable, type LeaseRow } from '@/components/tables/LeasesTable';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string; unitId: string }> };

const DEMO_UNIT = {
  id: 'demo-unit-1',
  propertyId: 'demo-property-1',
  orgId: 'demo-org-1',
  unitLabel: 'Unit 1',
  bedrooms: 2,
  bathrooms: 1,
  sizeSqm: 65,
  marketRent: 12500,
  status: 'occupied' as const,
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
};

const DEMO_LEASES: LeaseRow[] = [
  {
    id: 'demo-lease-1',
    orgId: 'demo-org-1',
    unitId: 'demo-unit-1',
    startDate: '2026-02-01',
    endDate: null,
    rentAmount: 12500,
    rentFrequency: 'monthly',
    depositAmount: 12500,
    status: 'active',
    source: 'manual',
    sourceDocumentId: null,
    sourceApplicationId: null,
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
  },
];

export default async function UnitDetailPage({ params }: RouteParams) {
  const { id: propertyId, unitId } = await params;

  if (ADMIN_DEMO_MODE) {
    if (propertyId !== 'demo-property-1' || unitId !== 'demo-unit-1') notFound();
    return <UnitDetailView unit={DEMO_UNIT} leases={DEMO_LEASES} propertyId={propertyId} canEdit />;
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('units')
    .select('*')
    .eq('id', unitId)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load unit: ${error.message}`);
  if (!data) notFound();

  const unit = mapUnitRow(data);

  const { data: leaseRows, error: leasesError } = await supabase
    .from('leases')
    .select('*')
    .eq('unit_id', unitId)
    .order('start_date', { ascending: false });
  if (leasesError) throw new Error(`Failed to load leases: ${leasesError.message}`);
  const leases: LeaseRow[] = (leaseRows ?? []).map(mapLeaseRow);

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, unit.orgId) : undefined;
  const canEdit = Boolean(membership && membership.role !== 'viewer' && membership.role !== 'accountant');

  return <UnitDetailView unit={unit} leases={leases} propertyId={propertyId} canEdit={canEdit} />;
}

function UnitDetailView({
  unit,
  leases,
  propertyId,
  canEdit,
}: {
  unit: {
    id: string;
    unitLabel: string;
    bedrooms: number | null;
    bathrooms: number | null;
    sizeSqm: number | null;
    marketRent: number | null;
    status: 'vacant' | 'occupied' | 'maintenance';
  };
  leases: LeaseRow[];
  propertyId: string;
  canEdit: boolean;
}) {
  const addLeaseAction = (
    <Link href={`/properties/${propertyId}/units/${unit.id}/leases/new`}>
      <Button variant="primary" size="sm">
        + Add lease
      </Button>
    </Link>
  );

  return (
    <div>
      <Link
        href={`/properties/${propertyId}`}
        className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
      >
        ← Back to property
      </Link>

      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">{unit.unitLabel}</h1>
        {canEdit ? (
          <Link href={`/properties/${propertyId}/units/${unit.id}/edit`}>
            <Button variant="secondary" size="sm">
              Edit
            </Button>
          </Link>
        ) : null}
      </div>
      <div className="mt-1">
        <StatusBadge presentation={UNIT_STATUS_PRESENTATION[unit.status]} />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Bedrooms</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">{unit.bedrooms ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Bathrooms</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">{unit.bathrooms ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Size</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            {unit.sizeSqm != null ? `${unit.sizeSqm} m²` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Market rent</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            {unit.marketRent != null ? `R${unit.marketRent.toLocaleString('en-ZA')}` : '—'}
          </dd>
        </div>
      </dl>

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
            Leases ({leases.length})
          </h2>
          {canEdit && leases.length > 0 ? addLeaseAction : null}
        </div>
        <div className="mt-3">
          <LeasesTable data={leases} emptyAction={canEdit ? addLeaseAction : undefined} />
        </div>
      </div>

      <p className="mt-8 text-xs text-light-textMuted dark:text-dark-textMuted">
        Tenants assigned to this unit's leases and maintenance history are built at the API layer
        (TASKS.md M8/M13) but not yet wired into this page — Leases is the current vertical slice,
        Maintenance is next.
      </p>
    </div>
  );
}
