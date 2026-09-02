import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Application, Inspection } from '@propvault/types';
import { UNIT_STATUS_PRESENTATION } from '@propvault/ui';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapUnitRow } from '@/lib/portfolio';
import { mapLeaseRow, mapApplicationRow } from '@/lib/leasing';
import { Users } from 'lucide-react';
import { mapInspectionRow } from '@/lib/operations';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { LeasesTable, type LeaseRow } from '@/components/tables/LeasesTable';
import { ApplicationsTable } from '@/components/tables/ApplicationsTable';
import { InspectionsTable } from '@/components/tables/InspectionsTable';
import { UnitActionsPanel } from '@/components/units/UnitActionsPanel';
import { UnitFinancesPanel } from '@/components/units/UnitFinancesPanel';
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

const DEMO_APPLICATIONS: Application[] = [
  {
    id: 'demo-application-1',
    orgId: 'demo-org-1',
    propertyId: 'demo-property-1',
    unitId: 'demo-unit-1',
    applicantName: 'Sipho Nkosi',
    applicantEmail: 'sipho@example.com',
    applicantPhone: '+27 84 555 0177',
    popiaConsentAt: null,
    screeningConsentAt: null,
    screeningStatus: 'not_started',
    status: 'submitted',
    decision: null,
    decisionReason: null,
    decidedBy: null,
    decidedAt: null,
    notes: null,
    dateOfBirth: null,
    currentAddress: null,
    employmentStatus: null,
    employerName: null,
    monthlyIncome: null,
    householdSize: null,
    applicantNotes: null,
    submittedAt: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  },
];

const DEMO_INSPECTIONS: Inspection[] = [
  {
    id: 'demo-inspection-1',
    orgId: 'demo-org-1',
    propertyId: 'demo-property-1',
    unitId: 'demo-unit-1',
    leaseId: 'demo-lease-1',
    inspectionType: 'move_in',
    scheduledAt: '2026-08-05T09:00:00Z',
    status: 'scheduled',
    landlordSignedAt: null,
    tenantSignedAt: null,
    tenantRefusalReason: null,
    completedAt: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  },
];

export default async function UnitDetailPage({ params }: RouteParams) {
  const { id: propertyId, unitId } = await params;

  if (ADMIN_DEMO_MODE) {
    if (propertyId !== 'demo-property-1' || unitId !== 'demo-unit-1') notFound();
    return (
      <UnitDetailView
        unit={DEMO_UNIT}
        leases={DEMO_LEASES}
        applications={DEMO_APPLICATIONS}
        inspections={DEMO_INSPECTIONS}
        propertyId={propertyId}
        canEdit
        isPrincipal
        activeLeaseId="demo-lease-1"
        currentTenants={[{ id: 'demo-tenant-1', fullName: 'Naledi Khumalo' }]}
      />
    );
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

  const [leasesResult, applicationsResult, inspectionsResult] = await Promise.all([
    supabase
      .from('leases')
      .select('*')
      .eq('unit_id', unitId)
      .order('start_date', { ascending: false }),
    supabase
      .from('applications')
      .select('*')
      .eq('unit_id', unitId)
      .order('created_at', { ascending: false }),
    supabase
      .from('inspections')
      .select('*')
      .eq('unit_id', unitId)
      .order('scheduled_at', { ascending: false }),
  ]);
  if (leasesResult.error) throw new Error(`Failed to load leases: ${leasesResult.error.message}`);
  if (applicationsResult.error)
    throw new Error(`Failed to load applications: ${applicationsResult.error.message}`);
  if (inspectionsResult.error)
    throw new Error(`Failed to load inspections: ${inspectionsResult.error.message}`);

  const leases: LeaseRow[] = (leasesResult.data ?? []).map(mapLeaseRow);
  const applications: Application[] = (applicationsResult.data ?? []).map(mapApplicationRow);
  const inspections: Inspection[] = (inspectionsResult.data ?? []).map(mapInspectionRow);

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, unit.orgId) : undefined;
  const canEdit = Boolean(membership && canWriteOrgRecords(membership.role));
  const isPrincipal = membership?.role === 'principal';

  // Tenant/occupancy V1 pass: "on an occupied unit, show the current tenant(s)" -- previously
  // this page deliberately omitted tenant identity (its own prior comment: "Tenants... are
  // managed from their own pages"). Only the ACTIVE lease's tenants qualify -- occupancy still
  // derives purely from lease status (sync_unit_status_from_lease trigger,
  // 20260101000079), never from this display.
  const activeLease = leases.find((l) => l.status === 'active');
  let currentTenants: { id: string; fullName: string }[] = [];
  if (activeLease) {
    const { data: leaseTenantRows, error: ltError } = await supabase
      .from('lease_tenants')
      .select('tenants(id, full_name)')
      .eq('lease_id', activeLease.id);
    if (ltError) throw new Error(`Failed to load current tenant: ${ltError.message}`);
    currentTenants = ((leaseTenantRows ?? []) as unknown as { tenants: { id: string; full_name: string } | null }[])
      .map((r) => r.tenants)
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .map((t) => ({ id: t.id, fullName: t.full_name }));
  }

  return (
    <UnitDetailView
      unit={unit}
      leases={leases}
      applications={applications}
      inspections={inspections}
      propertyId={propertyId}
      canEdit={canEdit}
      isPrincipal={isPrincipal}
      activeLeaseId={activeLease?.id ?? null}
      currentTenants={currentTenants}
    />
  );
}

function UnitDetailView({
  unit,
  leases,
  applications,
  inspections,
  propertyId,
  canEdit,
  isPrincipal,
  activeLeaseId = null,
  currentTenants = [],
}: {
  unit: {
    id: string;
    orgId: string;
    unitLabel: string;
    bedrooms: number | null;
    bathrooms: number | null;
    sizeSqm: number | null;
    marketRent: number | null;
    status: 'vacant' | 'occupied' | 'maintenance' | 'archived';
  };
  leases: LeaseRow[];
  applications: Application[];
  inspections: Inspection[];
  propertyId: string;
  canEdit: boolean;
  isPrincipal: boolean;
  activeLeaseId?: string | null;
  currentTenants?: { id: string; fullName: string }[];
}) {
  const addLeaseAction = (
    <Link href={`/properties/${propertyId}/units/${unit.id}/leases/new`}>
      <Button variant="primary" size="sm">
        + Add lease
      </Button>
    </Link>
  );

  const addApplicationAction = (
    <Link href={`/properties/${propertyId}/units/${unit.id}/applications/new`}>
      <Button variant="primary" size="sm">
        + New application
      </Button>
    </Link>
  );

  const addInspectionAction = (
    <Link href={`/properties/${propertyId}/units/${unit.id}/inspections/new`}>
      <Button variant="primary" size="sm">
        + Schedule inspection
      </Button>
    </Link>
  );

  return (
    <div className="space-y-6 animate-rise">
      <div>
        <Link
          href={`/properties/${propertyId}`}
          className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
        >
          ← Back to property
        </Link>
        <div className="mt-2">
          <PageHeader
            title={unit.unitLabel}
            actions={
              canEdit ? (
                <Link href={`/properties/${propertyId}/units/${unit.id}/edit`}>
                  <Button variant="secondary" size="sm">
                    Edit
                  </Button>
                </Link>
              ) : undefined
            }
          />
        </div>
        <div className="mt-1">
          <StatusBadge presentation={UNIT_STATUS_PRESENTATION[unit.status]} />
        </div>
      </div>

      {canEdit ? (
        <UnitActionsPanel
          unitId={unit.id}
          unitLabel={unit.unitLabel}
          status={unit.status}
          isPrincipal={isPrincipal}
          propertyId={propertyId}
        />
      ) : null}

      {currentTenants.length > 0 ? (
        <Panel title="Current tenant" bodyClassName="p-4">
          <ul className="space-y-2">
            {currentTenants.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm text-light-textPrimary dark:text-dark-textPrimary">
                  <Users className="h-4 w-4 shrink-0 text-light-textMuted dark:text-dark-textMuted" aria-hidden="true" />
                  {t.fullName}
                </span>
                <span className="flex items-center gap-3 text-xs">
                  <Link href={`/tenants/${t.id}`} className="text-light-accent hover:underline dark:text-dark-accent">
                    View tenant
                  </Link>
                  {activeLeaseId ? (
                    <Link href={`/leases/${activeLeaseId}`} className="text-light-accent hover:underline dark:text-dark-accent">
                      View lease
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="Unit details">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 text-sm lg:grid-cols-4">
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Bedrooms</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
              {unit.bedrooms ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Bathrooms</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
              {unit.bathrooms ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Size</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
              {unit.sizeSqm != null ? `${unit.sizeSqm} m²` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Market rent</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
              {unit.marketRent != null ? `R${unit.marketRent.toLocaleString('en-ZA')}` : '—'}
            </dd>
          </div>
        </dl>
      </Panel>

      <UnitFinancesPanel propertyId={propertyId} unitId={unit.id} orgId={unit.orgId} canManage={canEdit} />

      <div>
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

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
            Applications ({applications.length})
          </h2>
          {canEdit && applications.length > 0 ? addApplicationAction : null}
        </div>
        <div className="mt-3">
          <ApplicationsTable
            data={applications}
            emptyAction={canEdit ? addApplicationAction : undefined}
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
            Inspections ({inspections.length})
          </h2>
          {canEdit && inspections.length > 0 ? addInspectionAction : null}
        </div>
        <div className="mt-3">
          <InspectionsTable
            data={inspections}
            emptyAction={canEdit ? addInspectionAction : undefined}
          />
        </div>
      </div>

      <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
        Maintenance history for this unit's tenants is managed from their own pages.
      </p>
    </div>
  );
}
