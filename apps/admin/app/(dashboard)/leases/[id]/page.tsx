import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LEASE_STATUS_PRESENTATION } from '@propvault/ui';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapLeaseRow } from '@/lib/leasing';
import { resolvePortalSession, findActiveMembership } from '@/lib/orgSession';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import type { LeaseRow } from '@/components/tables/LeasesTable';

type RouteParams = { params: Promise<{ id: string }> };

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

export default async function LeaseDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-lease-1') notFound();
    return <LeaseDetailView lease={DEMO_LEASE} canEdit />;
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
    units: { unit_label: string; property_id: string; properties: { nickname: string } | null } | null;
  };
  const lease: LeaseRow = {
    ...mapLeaseRow(leaseRow),
    unitLabel: units?.unit_label,
    propertyId: units?.property_id,
    propertyNickname: units?.properties?.nickname,
  };

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, lease.orgId) : undefined;
  const canEdit = Boolean(membership && membership.role !== 'viewer' && membership.role !== 'accountant');

  return <LeaseDetailView lease={lease} canEdit={canEdit} />;
}

function LeaseDetailView({ lease, canEdit }: { lease: LeaseRow; canEdit: boolean }) {
  const backHref = lease.propertyId ? `/properties/${lease.propertyId}/units/${lease.unitId}` : '/leases';

  return (
    <div>
      <Link href={backHref} className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary">
        ← Back to {lease.propertyId ? 'unit' : 'leases'}
      </Link>

      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          {lease.propertyNickname ? `${lease.propertyNickname} — ${lease.unitLabel}` : (lease.unitLabel ?? 'Lease')}
        </h1>
        {canEdit ? (
          <Link href={`/leases/${lease.id}/edit`}>
            <Button variant="secondary" size="sm">
              Edit
            </Button>
          </Link>
        ) : null}
      </div>
      <div className="mt-1">
        <StatusBadge presentation={LEASE_STATUS_PRESENTATION[lease.status]} />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Start date</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">{lease.startDate}</dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">End date</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">{lease.endDate ?? 'Open-ended'}</dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Rent</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            R{lease.rentAmount.toLocaleString('en-ZA')} / {lease.rentFrequency}
          </dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Deposit</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            R{lease.depositAmount.toLocaleString('en-ZA')}
          </dd>
        </div>
      </dl>

      <p className="mt-8 text-xs text-light-textMuted dark:text-dark-textMuted">
        Tenants assigned to this lease, rent schedule, and trust deposit status are built at the
        API layer (TASKS.md M9/M10/M14) but not yet wired into this page — Leases is the current
        vertical slice, Maintenance is next.
      </p>
    </div>
  );
}
