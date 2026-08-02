import type { Inspection } from '@propvault/types';
import { InspectionsTable } from '@/components/tables/InspectionsTable';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapInspectionRow } from '@/lib/operations';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

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

/**
 * GET /inspections -- eighth module in the M20 vertical-slice sequence (TASKS.md), matching
 * PROPVIEW_SCREENSHOT_AUDIT.md's OPERATIONS nav section (Maintenance, Inspections). Same
 * direct-RLS-read pattern as every other list page this milestone.
 */
export default async function InspectionsPage() {
  const inspections: Inspection[] = ADMIN_DEMO_MODE ? DEMO_INSPECTIONS : await loadInspections();

  const scheduled = inspections.filter((i) => i.status === 'scheduled').length;
  const awaitingSignature = inspections.filter((i) => i.status === 'awaiting_signature').length;
  const completed = inspections.filter((i) => i.status === 'completed').length;

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">Inspections</h1>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        Every inspection across your portfolio. Inspections are scheduled from a unit.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <AdminMetricCard label="Scheduled" value={scheduled} />
        <AdminMetricCard label="Awaiting signature" value={awaitingSignature} />
        <AdminMetricCard label="Completed" value={completed} />
      </div>

      <div className="mt-6">
        <InspectionsTable data={inspections} />
      </div>
    </div>
  );
}

async function loadInspections(): Promise<Inspection[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('inspections')
    .select('*')
    .order('scheduled_at', { ascending: false });
  if (error) throw new Error(`Failed to load inspections: ${error.message}`);
  return (data ?? []).map(mapInspectionRow);
}
