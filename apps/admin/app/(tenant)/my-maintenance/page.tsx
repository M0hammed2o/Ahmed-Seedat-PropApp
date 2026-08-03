import Link from 'next/link';
import type { MaintenanceTicket } from '@propvault/types';
import { MAINTENANCE_STATUS_PRESENTATION, MAINTENANCE_PRIORITY_PRESENTATION } from '@propvault/ui';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapMaintenanceTicketRow } from '@/lib/operations';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_TICKETS: MaintenanceTicket[] = [
  {
    id: 'demo-tenant-ticket-1',
    orgId: 'demo-org-1',
    propertyId: 'demo-property-1',
    unitId: 'demo-unit-1',
    leaseId: 'demo-tenant-lease-1',
    tenantId: 'demo-tenant-1',
    submittedByUserId: null,
    submittedByTenantId: 'demo-tenant-1',
    summary: 'Kitchen tap leaking',
    description: 'Slow drip under the kitchen sink, getting worse.',
    priority: 'medium',
    status: 'to_do',
    assignedVendorId: null,
    createdAt: '2026-07-28T00:00:00Z',
    updatedAt: '2026-07-28T00:00:00Z',
    resolvedAt: null,
  },
];

/** GET /my-maintenance — tenant portal (V1 scope correction, 2026-08-01, DECISIONS.md). */
export default async function MyMaintenancePage() {
  const tickets = ADMIN_DEMO_MODE ? DEMO_TICKETS : await loadTickets();

  const addAction = (
    <Link href="/my-maintenance/new">
      <Button variant="primary" size="sm">
        + Submit request
      </Button>
    </Link>
  );

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="My Maintenance"
        subtitle="Requests you've submitted about your home."
        actions={addAction}
      />

      {tickets.length === 0 ? (
        <EmptyState
          icon={<span className="text-lg">🔧</span>}
          title="No maintenance requests yet"
          action={
            <Link href="/my-maintenance/new">
              <Button size="sm">+ Submit request</Button>
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-light-border bg-light-surfaceStrong dark:border-dark-border dark:bg-dark-surfaceStrong">
              <tr>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Summary</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Priority</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Status</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-b border-light-border last:border-0 dark:border-dark-border">
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">{t.summary}</td>
                  <td className="px-4 py-3">
                    <StatusBadge presentation={MAINTENANCE_PRIORITY_PRESENTATION[t.priority]} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge presentation={MAINTENANCE_STATUS_PRESENTATION[t.status]} />
                  </td>
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                    {t.createdAt.slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

async function loadTickets(): Promise<MaintenanceTicket[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('maintenance_tickets')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load maintenance requests: ${error.message}`);
  return (data ?? []).map(mapMaintenanceTicketRow);
}
