import type { MaintenanceTicket } from '@propvault/types';
import { MaintenanceFilterClient } from '@/components/maintenance/MaintenanceFilterClient';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapMaintenanceTicketRow } from '@/lib/operations';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

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

/**
 * GET /maintenance -- fifth and final module in this M20 pass (TASKS.md), evidenced
 * "Maintenance Board" (PROPVIEW_SCREENSHOT_AUDIT.md IMG_7967-7968): KPI row (one per real
 * MAINTENANCE_STATUSES value) + grouped-by-status board. Same direct-RLS-read pattern as every
 * other list page this milestone.
 */
export default async function MaintenancePage() {
  const tickets: MaintenanceTicket[] = ADMIN_DEMO_MODE ? DEMO_TICKETS : await loadTickets();

  const toDo = tickets.filter((t) => t.status === 'to_do').length;
  const inProgress = tickets.filter((t) => t.status === 'in_progress').length;
  const pendingApproval = tickets.filter((t) => t.status === 'pending_approval').length;
  const completed = tickets.filter((t) => t.status === 'completed').length;

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Maintenance"
        subtitle="Every maintenance ticket across your portfolio. Tickets are reported from a property."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <AdminMetricCard label="To do" value={toDo} />
        <AdminMetricCard label="In progress" value={inProgress} />
        <AdminMetricCard label="Pending approval" value={pendingApproval} />
        <AdminMetricCard label="Completed" value={completed} />
      </div>

      <MaintenanceFilterClient tickets={tickets} />
    </div>
  );
}

async function loadTickets(): Promise<MaintenanceTicket[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('maintenance_tickets')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load maintenance tickets: ${error.message}`);
  return (data ?? []).map(mapMaintenanceTicketRow);
}
