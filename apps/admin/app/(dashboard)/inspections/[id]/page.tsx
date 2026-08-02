import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Inspection, InspectionItem } from '@propvault/types';
import { INSPECTION_STATUS_PRESENTATION } from '@propvault/ui';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapInspectionRow, mapInspectionItemRow } from '@/lib/operations';
import { resolvePortalSession, findActiveMembership } from '@/lib/orgSession';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { InspectionActions } from '@/components/inspections/InspectionActions';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

const DEMO_INSPECTION: Inspection = {
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
};

export default async function InspectionDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-inspection-1') notFound();
    return <InspectionDetailView inspection={DEMO_INSPECTION} items={[]} canAct />;
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('inspections').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load inspection: ${error.message}`);
  if (!data) notFound();
  const inspection = mapInspectionRow(data);

  const { data: itemRows, error: itemsError } = await supabase
    .from('inspection_items')
    .select('*')
    .eq('inspection_id', id)
    .order('created_at', { ascending: true });
  if (itemsError) throw new Error(`Failed to load inspection items: ${itemsError.message}`);
  const items: InspectionItem[] = (itemRows ?? []).map(mapInspectionItemRow);

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, inspection.orgId) : undefined;
  const canAct = Boolean(membership && membership.role !== 'viewer' && membership.role !== 'accountant');

  return <InspectionDetailView inspection={inspection} items={items} canAct={canAct} />;
}

function InspectionDetailView({
  inspection,
  items,
  canAct,
}: {
  inspection: Inspection;
  items: InspectionItem[];
  canAct: boolean;
}) {
  return (
    <div>
      <Link
        href={`/properties/${inspection.propertyId}/units/${inspection.unitId}`}
        className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
      >
        ← Back to unit
      </Link>

      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold capitalize text-light-textPrimary dark:text-dark-textPrimary">
          {inspection.inspectionType.replace('_', ' ')} inspection
        </h1>
        <StatusBadge presentation={INSPECTION_STATUS_PRESENTATION[inspection.status]} />
      </div>
      <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
        Scheduled {new Date(inspection.scheduledAt).toLocaleString('en-ZA')}
      </p>

      <InspectionActions inspection={inspection} items={items} canAct={canAct} />
    </div>
  );
}
