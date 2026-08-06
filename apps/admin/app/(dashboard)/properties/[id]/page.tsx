import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { MaintenanceTicket, Property } from '@propvault/types';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapPropertyRow, mapUnitRow } from '@/lib/portfolio';
import { mapMaintenanceTicketRow } from '@/lib/operations';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { MapPin } from 'lucide-react';
import { UnitsTable, type UnitRow } from '@/components/tables/UnitsTable';
import { MaintenanceTable } from '@/components/tables/MaintenanceTable';
import { Avatar } from '@/components/ui/Avatar';
import { Panel } from '@/components/ui/Panel';
import { Pill, statusTone } from '@/components/ui/Pill';
import { SimpleTabs } from '@/components/ui/SimpleTabs';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { ValuationForm } from '@/components/properties/ValuationForm';

type RouteParams = { params: Promise<{ id: string }> };

interface PropertyTenant {
  id: string;
  fullName: string;
  unitLabel: string;
  rentAmount: number;
}

interface PropertyDocument {
  id: string;
  originalFileName: string;
  documentType: string;
  updatedAt: string;
}

interface PropertyAccounting {
  incomeYtd: number;
  expensesYtd: number;
}

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
  estimatedValue: null,
  estimatedValueAsOf: null,
  latitude: -33.9166,
  longitude: 18.3833,
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

const DEMO_TENANTS: PropertyTenant[] = [
  { id: 'demo-tenant-1', fullName: 'Naledi Khumalo', unitLabel: 'Unit 1', rentAmount: 12500 },
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
        tenants={DEMO_TENANTS}
        documents={[]}
        accounting={{ incomeYtd: 62500, expensesYtd: 4200 }}
        canManage
      />
    );
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('properties').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load property: ${error.message}`);
  if (!data) notFound();
  const property = mapPropertyRow(data);

  const [unitsResult, ticketsResult, documentsResult] = await Promise.all([
    supabase
      .from('units')
      .select('*')
      .eq('property_id', id)
      .order('unit_label', { ascending: true }),
    supabase
      .from('maintenance_tickets')
      .select('*')
      .eq('property_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('documents')
      .select('id, original_file_name, document_type, updated_at')
      .eq('property_id', id)
      .order('updated_at', { ascending: false })
      .limit(8),
  ]);
  if (unitsResult.error) throw new Error(`Failed to load units: ${unitsResult.error.message}`);
  if (ticketsResult.error)
    throw new Error(`Failed to load maintenance tickets: ${ticketsResult.error.message}`);

  const units: UnitRow[] = (unitsResult.data ?? []).map(mapUnitRow);
  const maintenanceTickets: MaintenanceTicket[] = (ticketsResult.data ?? []).map(
    mapMaintenanceTicketRow,
  );
  const documents: PropertyDocument[] = (documentsResult.data ?? []).map((d) => ({
    id: d.id,
    originalFileName: d.original_file_name,
    documentType: d.document_type,
    updatedAt: d.updated_at,
  }));

  const [tenants, accounting] = await Promise.all([
    loadPropertyTenants(supabase, units),
    loadPropertyAccounting(supabase, units),
  ]);

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, property.orgId) : undefined;
  const canManage = Boolean(membership && canWriteOrgRecords(membership.role));

  return (
    <PropertyDetailView
      property={property}
      units={units}
      maintenanceTickets={maintenanceTickets}
      tenants={tenants}
      documents={documents}
      accounting={accounting}
      canManage={canManage}
    />
  );
}

async function loadPropertyTenants(
  supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>,
  units: UnitRow[],
): Promise<PropertyTenant[]> {
  if (units.length === 0) return [];
  const unitIds = units.map((u) => u.id);
  const { data: leases } = await supabase
    .from('leases')
    .select('id, unit_id, rent_amount')
    .in('unit_id', unitIds)
    .eq('status', 'active');
  if (!leases || leases.length === 0) return [];
  const leaseIds = leases.map((l) => l.id);
  const { data: leaseTenants } = await supabase
    .from('lease_tenants')
    .select('lease_id, tenant_id')
    .in('lease_id', leaseIds);
  const tenantIds = [...new Set((leaseTenants ?? []).map((lt) => lt.tenant_id))];
  if (tenantIds.length === 0) return [];
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id, full_name')
    .in('id', tenantIds);
  const tenantNameById = new Map((tenants ?? []).map((t) => [t.id, t.full_name]));
  const unitLabelById = new Map(units.map((u) => [u.id, u.unitLabel]));
  const unitByLease = new Map(leases.map((l) => [l.id, l.unit_id]));
  const rentByLease = new Map(leases.map((l) => [l.id, l.rent_amount]));

  return (leaseTenants ?? [])
    .map((lt) => {
      const unitId = unitByLease.get(lt.lease_id);
      return {
        id: lt.tenant_id,
        fullName: tenantNameById.get(lt.tenant_id) ?? 'Unknown tenant',
        unitLabel: (unitId && unitLabelById.get(unitId)) || '—',
        rentAmount: Number(rentByLease.get(lt.lease_id) ?? 0),
      };
    })
    .filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i);
}

// Real year-to-date income/expenses for this property's own leases -- income from paid
// rent_schedules rows on this property's active leases, expenses from the org's `expenses` table
// filtered to this property (property scoping already exists on that table). Both computed from
// calendar-year-to-date, matching the "YTD" label Lovable's own card uses.
async function loadPropertyAccounting(
  supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>,
  units: UnitRow[],
): Promise<PropertyAccounting> {
  const yearStart = `${new Date().getFullYear()}-01-01`;
  if (units.length === 0) return { incomeYtd: 0, expensesYtd: 0 };
  const unitIds = units.map((u) => u.id);

  const { data: leases } = await supabase.from('leases').select('id').in('unit_id', unitIds);
  const leaseIds = (leases ?? []).map((l) => l.id);

  const [{ data: schedules }, { data: expenses }] = await Promise.all([
    leaseIds.length > 0
      ? supabase
          .from('rent_schedules')
          .select('amount, status, due_date')
          .in('lease_id', leaseIds)
          .gte('due_date', yearStart)
      : Promise.resolve({ data: [] as { amount: number; status: string; due_date: string }[] }),
    supabase
      .from('expenses')
      .select('amount, status, property_id, created_at')
      .eq('property_id', units[0]!.propertyId)
      .in('status', ['recorded', 'reimbursed'])
      .gte('created_at', yearStart),
  ]);

  const incomeYtd = (schedules ?? [])
    .filter((s) => s.status === 'paid')
    .reduce((sum, s) => sum + Number(s.amount), 0);
  const expensesYtd = (expenses ?? []).reduce((sum, e) => sum + Number(e.amount), 0);

  return { incomeYtd, expensesYtd };
}

function currency(n: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(n);
}

function PropertyDetailView({
  property,
  units,
  maintenanceTickets,
  tenants,
  documents,
  accounting,
  canManage,
}: {
  property: Property;
  units: UnitRow[];
  maintenanceTickets: MaintenanceTicket[];
  tenants: PropertyTenant[];
  documents: PropertyDocument[];
  accounting: PropertyAccounting;
  canManage: boolean;
}) {
  const addUnitAction = (
    <Link
      href={`/properties/${property.id}/units/new`}
      className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground"
    >
      + Add unit
    </Link>
  );
  const reportIssueAction = (
    <Link
      href={`/properties/${property.id}/maintenance/new`}
      className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground"
    >
      + Report issue
    </Link>
  );

  const occupiedCount = units.filter((u) => u.status === 'occupied').length;
  const imageSrc = property.imagePath ?? '/property-placeholder.svg';

  return (
    <>
      <Link
        href="/properties"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        ← All properties
      </Link>

      {/* Adapted from reference/lovable-ui-reference's properties/$propertyId.tsx hero band
          (2026-08-04 Lovable-adoption batch, UI_INTEGRATION_PLAN.md) -- real uploaded photo or the
          local placeholder graphic, never a hotlinked/fabricated image (same rule as the card grid). */}
      <div className="panel overflow-hidden">
        <div className="relative h-[220px]">
          <img
            src={imageSrc}
            alt={`${property.nickname} building`}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-foreground/75 to-transparent" />
          <div className="absolute right-5 bottom-5 left-5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2">
                <Pill tone={statusTone(property.status)} className="bg-card/90 backdrop-blur">
                  {property.status}
                </Pill>
                <span className="rounded-full bg-card/90 px-2.5 py-1 text-[11px] font-medium capitalize text-foreground backdrop-blur">
                  {property.propertyType.replace('_', ' ')}
                </span>
              </div>
              <h1 className="truncate font-display text-[26px] font-bold text-white">
                {property.nickname}
              </h1>
              <p className="flex items-center gap-1 truncate text-[13px] text-white/80">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{' '}
                {property.fullAddress}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4">
          {[
            {
              label: 'Valuation',
              value:
                property.estimatedValue !== null
                  ? currency(property.estimatedValue)
                  : 'Not available',
            },
            { label: 'Income YTD', value: currency(accounting.incomeYtd) },
            { label: 'Expenses YTD', value: currency(accounting.expensesYtd) },
            {
              label: 'Occupancy',
              value: `${units.length > 0 ? Math.round((occupiedCount / units.length) * 100) : 0}%`,
            },
          ].map((s) => (
            <div key={s.label} className="border-t border-border px-5 py-4">
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
              <p className="tabular mt-0.5 font-display text-lg font-bold text-foreground">
                {s.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {canManage ? (
        <Panel
          title="Property valuation"
          description="Optional -- feeds the Owner Dashboard's Portfolio Value card. Never estimated automatically."
        >
          <ValuationForm
            propertyId={property.id}
            currentValue={property.estimatedValue}
            currentAsOf={property.estimatedValueAsOf}
          />
        </Panel>
      ) : null}

      <SimpleTabs
        defaultTab="Overview"
        tabs={[
          {
            label: 'Overview',
            content: (
              <Panel title="Property details">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-5 text-sm lg:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">Type</dt>
                    <dd className="mt-0.5 capitalize text-foreground">
                      {property.propertyType.replace('_', ' ')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Municipal account</dt>
                    <dd className="mt-0.5 text-foreground">
                      {property.municipalAccountNumber ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Postal code</dt>
                    <dd className="mt-0.5 text-foreground">{property.postalCode ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Country</dt>
                    <dd className="mt-0.5 text-foreground">{property.country}</dd>
                  </div>
                </dl>
                {property.notes ? (
                  <div className="mt-5 border-t border-border pt-5">
                    <h3 className="text-sm font-medium text-foreground">Notes</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{property.notes}</p>
                  </div>
                ) : null}
              </Panel>
            ),
          },
          {
            label: `Units (${units.length})`,
            content: (
              <div>
                {canManage && units.length > 0 ? (
                  <div className="mb-3 flex justify-end">{addUnitAction}</div>
                ) : null}
                <UnitsTable data={units} emptyAction={canManage ? addUnitAction : undefined} />
              </div>
            ),
          },
          {
            label: `Tenants (${tenants.length})`,
            content:
              tenants.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {tenants.map((t) => (
                    <Panel key={t.id} bodyClassName="p-5">
                      <div className="flex items-center gap-3">
                        <Avatar
                          initials={initialsFor(t.fullName)}
                          className="h-10 w-10 text-[13px]"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{t.fullName}</p>
                          <p className="text-[11px] text-muted-foreground">{t.unitLabel}</p>
                        </div>
                      </div>
                      <div className="mt-4 flex items-center justify-between text-[12px]">
                        <span className="text-muted-foreground">Monthly rent</span>
                        <span className="tabular font-semibold text-foreground">
                          {currency(t.rentAmount)}
                        </span>
                      </div>
                    </Panel>
                  ))}
                </div>
              ) : (
                <p className="panel py-8 text-center text-sm text-muted-foreground">
                  No tenants linked to this property yet.
                </p>
              ),
          },
          {
            label: `Documents (${documents.length})`,
            content:
              documents.length > 0 ? (
                <Panel bodyClassName="p-5">
                  <ul className="grid gap-3 md:grid-cols-2">
                    {documents.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center gap-3 rounded-xl border border-border p-3.5"
                      >
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-[10px] font-bold text-primary">
                          {d.originalFileName.split('.').pop()?.toUpperCase() ?? 'DOC'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-foreground">
                            {d.originalFileName}
                          </p>
                          <p className="text-[11px] text-muted-foreground capitalize">
                            {d.documentType.replace('_', ' ')} ·{' '}
                            {new Date(d.updatedAt).toLocaleDateString('en-ZA')}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/documents"
                    className="mt-4 inline-block text-[12px] font-medium text-primary hover:underline"
                  >
                    View all documents →
                  </Link>
                </Panel>
              ) : (
                <div className="panel py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No documents uploaded for this property yet.
                  </p>
                  <Link
                    href="/documents/new"
                    className="mt-2 inline-block text-[12px] font-medium text-primary hover:underline"
                  >
                    Upload a document →
                  </Link>
                </div>
              ),
          },
          {
            label: `Maintenance (${maintenanceTickets.length})`,
            content: (
              <div>
                {canManage && maintenanceTickets.length > 0 ? (
                  <div className="mb-3 flex justify-end">{reportIssueAction}</div>
                ) : null}
                <MaintenanceTable
                  data={maintenanceTickets}
                  emptyAction={canManage ? reportIssueAction : undefined}
                />
              </div>
            ),
          },
          {
            label: 'Accounting',
            content: (
              <div className="grid gap-4 sm:grid-cols-2">
                <Panel bodyClassName="p-5">
                  <p className="text-[11px] text-muted-foreground">Income YTD</p>
                  <p className="tabular mt-1 font-display text-xl font-bold text-foreground">
                    {currency(accounting.incomeYtd)}
                  </p>
                </Panel>
                <Panel bodyClassName="p-5">
                  <p className="text-[11px] text-muted-foreground">Expenses YTD</p>
                  <p className="tabular mt-1 font-display text-xl font-bold text-foreground">
                    {currency(accounting.expensesYtd)}
                  </p>
                </Panel>
                <Link
                  href="/accounting/rent-due"
                  className="col-span-2 text-[12px] font-medium text-primary hover:underline"
                >
                  View full accounting →
                </Link>
              </div>
            ),
          },
          {
            // Lovable's Reports tab lists Rent roll / Arrears ageing / Maintenance spend / Lease
            // expiry / Owner statement / Vacancy analysis as one-click downloads. None of these
            // exist as a per-property report generator anywhere in PropertyVault today (the real
            // Owner Statements/Tax Pack features that do exist are org-wide, not property-scoped) --
            // preserved as a tab with a truthful "not built yet" state rather than fake download
            // buttons that produce nothing.
            label: 'Reports',
            content: (
              <p className="panel py-8 text-center text-sm text-muted-foreground">
                Per-property report exports aren&apos;t available yet. Org-wide reports are on the{' '}
                <Link href="/reports" className="text-primary hover:underline">
                  Reports
                </Link>{' '}
                page.
              </p>
            ),
          },
        ]}
      />
    </>
  );
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
