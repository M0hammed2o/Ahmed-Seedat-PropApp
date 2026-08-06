import type { Lease } from '@propvault/types';
import { LEASE_STATUS_PRESENTATION } from '@propvault/ui';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

interface LeaseWithContext extends Lease {
  unitLabel?: string;
  propertyNickname?: string;
}

const DEMO_LEASES: LeaseWithContext[] = [
  {
    id: 'demo-tenant-lease-1',
    orgId: 'demo-org-1',
    unitId: 'demo-unit-1',
    startDate: '2026-02-01',
    endDate: '2027-01-31',
    rentAmount: 10650,
    rentFrequency: 'monthly',
    depositAmount: 10650,
    status: 'active',
    source: 'application_approved',
    sourceDocumentId: null,
    sourceApplicationId: null,
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    unitLabel: 'Unit 4B',
    propertyNickname: 'Oakwood Apartments',
  },
];

/** GET /my-lease — tenant portal, V1 scope correction (2026-08-01, DECISIONS.md/PERMISSIONS.md §4). */
export default async function MyLeasePage() {
  const leases = ADMIN_DEMO_MODE ? DEMO_LEASES : await loadLeases();

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title="My Lease" subtitle="Your current and past lease agreements." />

      {leases.length === 0 ? (
        <EmptyState
          icon={<span className="text-lg">🏠</span>}
          title="No lease on file"
          description="Contact your landlord or property manager if you believe this is incorrect."
        />
      ) : (
        <div className="space-y-4">
          {leases.map((lease) => (
            <div
              key={lease.id}
              className="rounded-card border border-light-border bg-light-surfaceRaised p-5 shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                  {lease.propertyNickname ?? 'Property'} — {lease.unitLabel ?? 'Unit'}
                </p>
                <StatusBadge presentation={LEASE_STATUS_PRESENTATION[lease.status]} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-light-textMuted dark:text-dark-textMuted">Rent</dt>
                  <dd className="mt-1 text-light-textPrimary dark:text-dark-textPrimary">
                    R{lease.rentAmount.toLocaleString('en-ZA')} / {lease.rentFrequency}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-light-textMuted dark:text-dark-textMuted">Deposit</dt>
                  <dd className="mt-1 text-light-textPrimary dark:text-dark-textPrimary">
                    R{lease.depositAmount.toLocaleString('en-ZA')}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-light-textMuted dark:text-dark-textMuted">
                    Start date
                  </dt>
                  <dd className="mt-1 text-light-textPrimary dark:text-dark-textPrimary">
                    {lease.startDate}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-light-textMuted dark:text-dark-textMuted">
                    End date
                  </dt>
                  <dd className="mt-1 text-light-textPrimary dark:text-dark-textPrimary">
                    {lease.endDate ?? 'Ongoing'}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

async function loadLeases(): Promise<LeaseWithContext[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('leases')
    .select('*, units(unit_label, properties(nickname))')
    .order('start_date', { ascending: false });
  if (error) throw new Error(`Failed to load lease: ${error.message}`);

  return (data ?? []).map((row) => {
    const { units, ...leaseRow } = row as typeof row & {
      units: { unit_label: string; properties: { nickname: string } | null } | null;
    };
    return {
      id: leaseRow.id,
      orgId: leaseRow.org_id,
      unitId: leaseRow.unit_id,
      startDate: leaseRow.start_date,
      endDate: leaseRow.end_date,
      rentAmount: leaseRow.rent_amount,
      rentFrequency: leaseRow.rent_frequency,
      depositAmount: leaseRow.deposit_amount,
      status: leaseRow.status,
      source: leaseRow.source,
      sourceDocumentId: leaseRow.source_document_id,
      sourceApplicationId: leaseRow.source_application_id,
      createdAt: leaseRow.created_at,
      updatedAt: leaseRow.updated_at,
      unitLabel: units?.unit_label,
      propertyNickname: units?.properties?.nickname,
    };
  });
}
