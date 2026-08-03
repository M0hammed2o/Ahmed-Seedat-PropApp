import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { MaintenanceTicket, Property } from '@propvault/types';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapPropertyRow, mapUnitRow } from '@/lib/portfolio';
import { mapMaintenanceTicketRow } from '@/lib/operations';
import { resolvePortalSession, findActiveMembership } from '@/lib/orgSession';
import { Building2, MapPin } from 'lucide-react';
import { UnitsTable, type UnitRow } from '@/components/tables/UnitsTable';
import { MaintenanceTable } from '@/components/tables/MaintenanceTable';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Pill } from '@/components/ui/Pill';
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

const DEMO_TICKETS: MaintenanceTicket[] = [
  {
    id: 'demo-ticket-1',
    orgId: 'demo-org-1',
    propertyId: 'demo-property-1',
    unitId: 'demo-unit-1',
    leaseId: 'demo-lease-1',
    tenantId: null,
    submittedByUserId: 'demo-user-1',
    submittedByTenantId: null,
    summary: 'Leaking kitchen tap',
    description: 'Constant drip from the cold tap, worsening over the past week.',
    priority: 'medium',
    status: 'to_do',
    assignedVendorId: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    resolvedAt: null,
  },
];

export default async function PropertyDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-property-1') notFound();
    return (
      <PropertyDetailView
        property={DEMO_PROPERTY}
        units={DEMO_UNITS}
        maintenanceTickets={DEMO_TICKETS}
        canManage
      />
    );
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('properties').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load property: ${error.message}`);
  if (!data) notFound();
  const property = mapPropertyRow(data);

  const [unitsResult, ticketsResult] = await Promise.all([
    supabase.from('units').select('*').eq('property_id', id).order('unit_label', { ascending: true }),
    supabase
      .from('maintenance_tickets')
      .select('*')
      .eq('property_id', id)
      .order('created_at', { ascending: false }),
  ]);
  if (unitsResult.error) throw new Error(`Failed to load units: ${unitsResult.error.message}`);
  if (ticketsResult.error) throw new Error(`Failed to load maintenance tickets: ${ticketsResult.error.message}`);

  const units: UnitRow[] = (unitsResult.data ?? []).map(mapUnitRow);
  const maintenanceTickets: MaintenanceTicket[] = (ticketsResult.data ?? []).map(mapMaintenanceTicketRow);

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, property.orgId) : undefined;
  const canManage = Boolean(membership && membership.role !== 'viewer' && membership.role !== 'accountant');

  return <PropertyDetailView property={property} units={units} maintenanceTickets={maintenanceTickets} canManage={canManage} />;
}

function PropertyDetailView({
  property,
  units,
  maintenanceTickets,
  canManage,
}: {
  property: Property;
  units: UnitRow[];
  maintenanceTickets: MaintenanceTicket[];
  canManage: boolean;
}) {
  const addUnitAction = (
    <Link href={`/properties/${property.id}/units/new`}>
      <Button variant="primary" size="sm">
        + Add unit
      </Button>
    </Link>
  );

  const reportIssueAction = (
    <Link href={`/properties/${property.id}/maintenance/new`}>
      <Button variant="primary" size="sm">
        + Report issue
      </Button>
    </Link>
  );

  const occupiedCount = units.filter((u) => u.status === 'occupied').length;

  return (
    <div className="space-y-6 animate-rise">
      {/* Hero header adapted from reference/lovable-ui-reference's properties/$propertyId.tsx
          (UI_INTEGRATION_PLAN.md) -- image band + gradient + status pill + stat strip. No property
          photo storage exists yet (Property.imagePath is always null in practice), so the band
          shows a placeholder icon rather than a hotlinked/fabricated photo. Only the hero is
          adapted; Units/Tenants/Documents/Accounting stay their own real routes, not tabs on this
          page (see UI_INTEGRATION_PLAN.md's "deliberate adaptation decisions"). */}
      <div className="overflow-hidden rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised">
        <div className="relative flex h-[160px] items-center justify-center bg-light-accentSoft dark:bg-dark-accentSoft">
          <Building2 size={40} className="text-light-accent/40 dark:text-dark-accent/40" aria-hidden="true" />
          <div className="absolute right-5 bottom-4 left-5 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2">
                <Pill tone={property.status === 'active' ? 'success' : 'neutral'} className="bg-light-surfaceRaised/90 dark:bg-dark-surfaceRaised/90">
                  {property.status}
                </Pill>
                <span className="rounded-pill bg-light-surfaceRaised/90 px-2.5 py-1 text-[11px] font-medium capitalize text-light-textPrimary dark:bg-dark-surfaceRaised/90 dark:text-dark-textPrimary">
                  {property.propertyType.replace('_', ' ')}
                </span>
              </div>
              <h1 className="truncate font-display text-2xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
                {property.nickname}
              </h1>
              <p className="flex items-center gap-1 truncate text-[13px] text-light-textSecondary dark:text-dark-textSecondary">
                <MapPin size={13} className="shrink-0" aria-hidden="true" /> {property.fullAddress}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 divide-y divide-light-border sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-dark-border">
          {[
            { label: 'Units', value: String(units.length) },
            { label: 'Occupied', value: String(occupiedCount) },
            { label: 'City', value: property.city },
            { label: 'Province', value: property.province ?? '—' },
          ].map((s) => (
            <div key={s.label} className="border-t border-light-border px-5 py-4 sm:border-t-0 dark:border-dark-border">
              <p className="text-[11px] text-light-textMuted dark:text-dark-textMuted">{s.label}</p>
              <p className="tabular-nums-feature mt-0.5 truncate font-display text-lg font-bold text-light-textPrimary dark:text-dark-textPrimary">
                {s.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      <Panel title="Property details">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 text-sm lg:grid-cols-4">
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Type</dt>
            <dd className="mt-0.5 capitalize text-light-textPrimary dark:text-dark-textPrimary">
              {property.propertyType.replace('_', ' ')}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Municipal account</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
              {property.municipalAccountNumber ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Postal code</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">{property.postalCode ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Country</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">{property.country}</dd>
          </div>
        </dl>

        {property.notes ? (
          <div className="mt-5 border-t border-light-border pt-5 dark:border-dark-border">
            <h3 className="text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">Notes</h3>
            <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">{property.notes}</p>
          </div>
        ) : null}
      </Panel>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
            Units ({units.length})
          </h2>
          {canManage && units.length > 0 ? addUnitAction : null}
        </div>
        <div className="mt-3">
          <UnitsTable data={units} emptyAction={canManage ? addUnitAction : undefined} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
            Maintenance ({maintenanceTickets.length})
          </h2>
          {canManage && maintenanceTickets.length > 0 ? reportIssueAction : null}
        </div>
        <div className="mt-3">
          <MaintenanceTable data={maintenanceTickets} emptyAction={canManage ? reportIssueAction : undefined} />
        </div>
      </div>

      <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
        Leases and tenants for this property's units are managed from each unit's own page.
        Owners are built at the API layer (TASKS.md M7) but not yet wired into any page.
      </p>
    </div>
  );
}
