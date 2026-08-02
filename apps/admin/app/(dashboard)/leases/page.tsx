import Link from 'next/link';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapLeaseRow } from '@/lib/leasing';
import { LeasesTable, type LeaseRow } from '@/components/tables/LeasesTable';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { Button } from '@/components/ui/Button';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

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
    unitLabel: 'Unit 1',
    propertyId: 'demo-property-1',
    propertyNickname: 'Sea Point Apartment',
  },
];

/**
 * GET /leases -- fourth module in the M20 vertical-slice sequence (TASKS.md). Same "plain
 * RLS-protected read" pattern as /properties, /tenants, /units, joined against units->properties
 * for the unit/property context columns (leases.unit_id FK, units.property_id FK -- both
 * PostgREST-embeddable in one query).
 */
export default async function LeasesPage() {
  const leases: LeaseRow[] = ADMIN_DEMO_MODE ? DEMO_LEASES : await loadLeases();

  const active = leases.filter((l) => l.status === 'active').length;
  const draft = leases.filter((l) => l.status === 'draft').length;

  const addAction = (
    <Link href="/properties">
      <Button variant="primary" size="sm">
        Go to a unit to add a lease
      </Button>
    </Link>
  );

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">Leases</h1>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        Every lease across your portfolio. Leases are added from a unit.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <AdminMetricCard label="Total leases" value={leases.length} />
        <AdminMetricCard label="Active" value={active} />
        <AdminMetricCard label="Draft" value={draft} />
      </div>

      <div className="mt-6">
        <LeasesTable
          data={leases}
          showUnit
          emptyMessage="No leases yet"
          emptyAction={leases.length === 0 ? addAction : undefined}
        />
      </div>
    </div>
  );
}

async function loadLeases(): Promise<LeaseRow[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('leases')
    .select('*, units(unit_label, property_id, properties(nickname))')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load leases: ${error.message}`);

  return (data ?? []).map((row) => {
    const { units, ...leaseRow } = row as typeof row & {
      units: { unit_label: string; property_id: string; properties: { nickname: string } | null } | null;
    };
    return {
      ...mapLeaseRow(leaseRow),
      unitLabel: units?.unit_label,
      propertyId: units?.property_id,
      propertyNickname: units?.properties?.nickname,
    };
  });
}
