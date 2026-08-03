import Link from 'next/link';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapUnitRow } from '@/lib/portfolio';
import { UnitsTable, type UnitRow } from '@/components/tables/UnitsTable';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

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
    propertyNickname: 'Sea Point Apartment',
  },
];

/**
 * GET /units -- org-wide Units list (TASKS.md M20), mirroring PROPVIEW_SCREENSHOT_AUDIT.md's
 * evidenced "Landlord Console > Units" module (its own top-level PORTFOLIO nav item, not only
 * reachable through a property) and its KPI-row + "No units yet" formula
 * (PROPVIEW_SCREENSHOT_AUDIT.md IMG_7998-7999, IMG_8092). No GET /api/v1/units endpoint exists
 * (API_SPEC.md §3 only has the property-scoped list/create and the by-id read/update) -- same
 * "plain RLS-protected read" pattern the Properties page already uses, joined against properties
 * for the nickname column PostgREST can embed directly via the units.property_id FK.
 */
export default async function UnitsPage() {
  const units: UnitRow[] = ADMIN_DEMO_MODE ? DEMO_UNITS : await loadUnits();

  const total = units.length;
  const occupied = units.filter((u) => u.status === 'occupied').length;
  const vacant = units.filter((u) => u.status === 'vacant').length;

  const addAction = (
    <Link href="/properties">
      <Button variant="primary" size="sm">
        Go to a property to add a unit
      </Button>
    </Link>
  );

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title="Units" subtitle="Every unit across your portfolio. Units are added from a property." />

      <div className="grid grid-cols-3 gap-4">
        <AdminMetricCard label="Total units" value={total} />
        <AdminMetricCard label="Occupied" value={occupied} />
        <AdminMetricCard label="Vacant" value={vacant} />
      </div>

      <UnitsTable
        data={units}
        showProperty
        emptyMessage="No units yet"
        emptyAction={total === 0 ? addAction : undefined}
      />
    </div>
  );
}

async function loadUnits(): Promise<UnitRow[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('units')
    .select('*, properties(nickname)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load units: ${error.message}`);

  return (data ?? []).map((row) => {
    const { properties, ...unitRow } = row as typeof row & { properties: { nickname: string } | null };
    return { ...mapUnitRow(unitRow), propertyNickname: properties?.nickname };
  });
}
