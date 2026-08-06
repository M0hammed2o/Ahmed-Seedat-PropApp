import Link from 'next/link';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapUnitRow } from '@/lib/portfolio';
import { UnitsTable, type UnitRow } from '@/components/tables/UnitsTable';
import { UnitsFilterClient } from '@/components/units/UnitsFilterClient';
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
 * GET /units -- org-wide Units list (TASKS.md M20), rebuilt against reference/lovable-ui-reference's
 * units/index.tsx literal PageHeader/subtitle/status-tab composition (2026-08-04 Lovable-adoption
 * batch). No GET /api/v1/units endpoint exists (API_SPEC.md §3 only has the property-scoped
 * list/create and the by-id read/update) -- same "plain RLS-protected read" pattern the Properties
 * page already uses, joined against properties for the nickname column PostgREST can embed
 * directly via the units.property_id FK.
 */
export default async function UnitsPage() {
  const units: UnitRow[] = ADMIN_DEMO_MODE ? DEMO_UNITS : await loadUnits();

  const total = units.length;
  const vacant = units.filter((u) => u.status === 'vacant').length;

  const addAction = (
    <Link
      href="/properties"
      className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground shadow-glow"
    >
      + Add unit
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Units"
        subtitle={
          total > 0
            ? `${total} ${total === 1 ? 'unit' : 'units'} across the portfolio · ${vacant} currently available`
            : 'Every unit across your portfolio. Units are added from a property.'
        }
        actions={addAction}
      />

      {total === 0 ? (
        <UnitsTable data={[]} showProperty emptyMessage="No units yet" emptyAction={addAction} />
      ) : (
        <UnitsFilterClient units={units} />
      )}
    </>
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
    const { properties, ...unitRow } = row as typeof row & {
      properties: { nickname: string } | null;
    };
    return { ...mapUnitRow(unitRow), propertyNickname: properties?.nickname };
  });
}
