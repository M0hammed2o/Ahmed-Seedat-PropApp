import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { RentSchedule, Tenant, TrustLedger } from '@propvault/types';
import { LEASE_STATUS_PRESENTATION, TENANT_STATUS_PRESENTATION } from '@propvault/ui';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapLeaseRow, mapTenantRow, mapRentScheduleRow } from '@/lib/leasing';
import { mapTrustLedgerRow } from '@/lib/accounting';
import {
  resolvePortalSession,
  findActiveMembership,
  canPostAccountingRecords,
  canWriteOrgRecords,
} from '@/lib/orgSession';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { LeaseRentScheduleClient } from '@/components/leases/LeaseRentScheduleClient';
import { LeaseActions } from '@/components/leases/LeaseActions';
import { DepositPanel } from '@/components/leases/DepositPanel';
import { LeaseOccupantsPanel } from '@/components/leases/LeaseOccupantsPanel';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import type { LeaseRow } from '@/components/tables/LeasesTable';

type RouteParams = { params: Promise<{ id: string }> };

interface LeaseTenant {
  tenant: Tenant;
  isPrimary: boolean;
}

const DEMO_LEASE: LeaseRow = {
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
  unitLabel: 'Unit 1',
  propertyId: 'demo-property-1',
  propertyNickname: 'Sea Point Apartment',
};

const DEMO_LEASE_TENANTS: LeaseTenant[] = [
  {
    isPrimary: true,
    tenant: {
      id: 'demo-tenant-1',
      orgId: 'demo-org-1',
      userId: null,
      fullName: 'Naledi Khumalo',
      email: 'naledi@example.com',
      phone: '+27 82 555 0134',
      idNumberRef: null,
      status: 'active',
      createdAt: '2026-06-05T00:00:00Z',
      updatedAt: '2026-06-05T00:00:00Z',
    },
  },
];

const DEMO_RENT_SCHEDULE: RentSchedule[] = [
  {
    id: 'demo-rs-1',
    orgId: 'demo-org-1',
    leaseId: 'demo-lease-1',
    dueDate: '2026-08-01',
    amount: 12500,
    status: 'overdue',
    generatedAt: '2026-08-01T00:00:00Z',
  },
  {
    id: 'demo-rs-2',
    orgId: 'demo-org-1',
    leaseId: 'demo-lease-1',
    dueDate: '2026-07-01',
    amount: 12500,
    status: 'paid',
    generatedAt: '2026-07-01T00:00:00Z',
  },
  {
    id: 'demo-rs-3',
    orgId: 'demo-org-1',
    leaseId: 'demo-lease-1',
    dueDate: '2026-06-01',
    amount: 12500,
    status: 'paid',
    generatedAt: '2026-06-01T00:00:00Z',
  },
];

export default async function LeaseDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-lease-1') notFound();
    return (
      <LeaseDetailView
        lease={DEMO_LEASE}
        canEdit
        canPost
        leaseTenants={DEMO_LEASE_TENANTS}
        rentSchedule={DEMO_RENT_SCHEDULE}
        trustLedger={null}
      />
    );
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('leases')
    .select('*, units(unit_label, property_id, properties(nickname))')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load lease: ${error.message}`);
  if (!data) notFound();

  const { units, ...leaseRow } = data as typeof data & {
    units: {
      unit_label: string;
      property_id: string;
      properties: { nickname: string } | null;
    } | null;
  };
  const lease: LeaseRow = {
    ...mapLeaseRow(leaseRow),
    unitLabel: units?.unit_label,
    propertyId: units?.property_id,
    propertyNickname: units?.properties?.nickname,
  };

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, lease.orgId) : undefined;
  const canEdit = Boolean(membership && canWriteOrgRecords(membership.role));
  const canPost = Boolean(membership && canPostAccountingRecords(membership.role));

  const { data: ltData, error: ltError } = await supabase
    .from('lease_tenants')
    .select('is_primary, tenants(*)')
    .eq('lease_id', id)
    .order('is_primary', { ascending: false });
  if (ltError) throw new Error(`Failed to load lease tenants: ${ltError.message}`);
  // lease_tenants.tenant_id -> tenants.id is many-to-one, so PostgREST embeds a single object at
  // runtime -- the `tenants(*)` embed syntax just can't express that cardinality to an untyped
  // client (no generated Database types), so supabase-js's inferred type is wrong, not the data.
  const ltRows = (ltData ?? []) as unknown as {
    is_primary: boolean;
    tenants: Record<string, unknown> | null;
  }[];
  const leaseTenants: LeaseTenant[] = ltRows
    .filter((r): r is typeof r & { tenants: NonNullable<typeof r.tenants> } => r.tenants !== null)
    .map((r) => ({
      tenant: mapTenantRow(r.tenants as unknown as Parameters<typeof mapTenantRow>[0]),
      isPrimary: r.is_primary,
    }));

  const { data: rsRows, error: rsError } = await supabase
    .from('rent_schedules')
    .select('*')
    .eq('lease_id', id)
    .order('due_date', { ascending: false });
  if (rsError) throw new Error(`Failed to load rent schedule: ${rsError.message}`);
  const rentSchedule = (rsRows ?? []).map(mapRentScheduleRow);

  const { data: tlRow, error: tlError } = await supabase
    .from('trust_ledgers')
    .select('*')
    .eq('lease_id', id)
    .maybeSingle();
  if (tlError) throw new Error(`Failed to load trust ledger: ${tlError.message}`);
  const trustLedger = tlRow ? mapTrustLedgerRow(tlRow) : null;

  return (
    <LeaseDetailView
      lease={lease}
      canEdit={canEdit}
      canPost={canPost}
      leaseTenants={leaseTenants}
      rentSchedule={rentSchedule}
      trustLedger={trustLedger}
    />
  );
}

function LeaseDetailView({
  lease,
  canEdit,
  canPost,
  leaseTenants,
  rentSchedule,
  trustLedger,
}: {
  lease: LeaseRow;
  canEdit: boolean;
  canPost: boolean;
  leaseTenants: LeaseTenant[];
  rentSchedule: RentSchedule[];
  trustLedger: TrustLedger | null;
}) {
  const backHref = lease.propertyId
    ? `/properties/${lease.propertyId}/units/${lease.unitId}`
    : '/leases';

  return (
    <div className="space-y-6 animate-rise">
      <div>
        <Link
          href={backHref}
          className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
        >
          ← Back to {lease.propertyId ? 'unit' : 'leases'}
        </Link>
        <div className="mt-2">
          <PageHeader
            title={
              lease.propertyNickname
                ? `${lease.propertyNickname} — ${lease.unitLabel}`
                : (lease.unitLabel ?? 'Lease')
            }
            actions={
              canEdit ? (
                <div className="flex gap-2">
                  {/* V1 launch-completion pass, Section 8: Prepare/Send is the
                      generate-document -> review -> send-for-signature workflow -- correct for a
                      NEW application-approved lease, but a manual/imported lease's tenant has
                      already physically signed outside Proplyst. Gated on source, not just status,
                      so an imported lease never shows a re-signature path; LeaseActions below
                      offers the direct upload+Activate path for it instead. */}
                  {lease.status === 'draft' && lease.source === 'application_approved' ? (
                    <Link href={`/leases/${lease.id}/prepare`}>
                      <Button variant="primary" size="sm">
                        Prepare lease
                      </Button>
                    </Link>
                  ) : null}
                  <Link href={`/leases/${lease.id}/edit`}>
                    <Button variant="secondary" size="sm">
                      Edit
                    </Button>
                  </Link>
                </div>
              ) : undefined
            }
          />
        </div>
        <div className="mt-1">
          <StatusBadge presentation={LEASE_STATUS_PRESENTATION[lease.status]} />
        </div>
      </div>

      <Panel title="Lease details">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 text-sm lg:grid-cols-4">
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Lease type</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
              {lease.endDate ? 'Fixed term' : 'Ongoing / Month-to-month'}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Start date</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
              {lease.startDate}
            </dd>
          </div>
          <div>
            {/* V1 launch-completion pass, Section 9: expiry shown prominently for a fixed-term
                lease (it's the field that matters most); month-to-month states its own nature
                explicitly rather than showing a blank/"Open-ended" label that reads like a gap. */}
            <dt className="text-light-textMuted dark:text-dark-textMuted">
              {lease.endDate ? 'Expiry date' : 'End date'}
            </dt>
            <dd
              className={`mt-0.5 ${lease.endDate ? 'font-semibold text-light-statusNeedsReview dark:text-dark-statusNeedsReview' : 'text-light-textPrimary dark:text-dark-textPrimary'}`}
            >
              {lease.endDate ?? 'Ongoing / Month-to-month'}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Rent</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
              R{lease.rentAmount.toLocaleString('en-ZA')} / {lease.rentFrequency}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Deposit</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
              R{lease.depositAmount.toLocaleString('en-ZA')}
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel title="Tenants">
        {leaseTenants.length === 0 ? (
          <p className="text-sm text-light-textMuted dark:text-dark-textMuted">
            No tenant assigned to this lease yet.
          </p>
        ) : (
          <ul className="divide-y divide-light-border dark:divide-dark-border">
            {leaseTenants.map(({ tenant, isPrimary }) => (
              <li
                key={tenant.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <Link
                  href={`/tenants/${tenant.id}`}
                  className="group flex min-w-0 items-center gap-2.5"
                >
                  <Avatar
                    initials={initialsFor(tenant.fullName)}
                    tone="muted"
                    className="h-8 w-8 text-[11px]"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-light-accent group-hover:underline dark:text-dark-accent">
                      {tenant.fullName}
                      {isPrimary ? (
                        <span className="ml-1.5 text-xs font-normal text-light-textMuted dark:text-dark-textMuted">
                          (primary)
                        </span>
                      ) : null}
                    </span>
                  </span>
                </Link>
                <StatusBadge presentation={TENANT_STATUS_PRESENTATION[tenant.status]} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <LeaseOccupantsPanel leaseId={lease.id} canManage={canEdit} />

      <LeaseActions
        leaseId={lease.id}
        orgId={lease.orgId}
        status={lease.status}
        hasTenant={leaseTenants.length > 0}
        canEdit={canEdit}
        source={lease.source === 'application_approved' ? 'application_approved' : 'manual'}
      />

      {/* Not wrapped in a Panel -- AdminDataTable (which RentScheduleTable/LeaseRentScheduleClient
          render through) already supplies its own bordered/rounded/shadowed card, same as the bare
          RentDueClient placement on the Rent Due page; a second Panel around it would double the
          card chrome. */}
      <div>
        <h2 className="mb-2.5 text-[15px] font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Rent schedule
        </h2>
        {lease.status === 'draft' ? (
          <p className="rounded-lg border border-light-border p-4 text-sm text-light-textMuted dark:border-dark-border dark:text-dark-textMuted">
            Rent schedule will be generated once this lease is activated.
          </p>
        ) : (
          <LeaseRentScheduleClient data={rentSchedule} canPost={canPost} />
        )}
      </div>

      <DepositPanel
        leaseId={lease.id}
        leaseStatus={lease.status}
        depositAmount={lease.depositAmount}
        trustLedger={trustLedger}
        canPost={canPost}
      />
    </div>
  );
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
