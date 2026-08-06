import { Wrench } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

interface OwnerMaintenanceRow {
  id: string;
  summary: string;
  propertyNickname: string | null;
  priority: string;
  status: string;
  createdAt: string;
}

const DEMO_TICKETS: OwnerMaintenanceRow[] = [
  {
    id: 'demo-owner-ticket-1',
    summary: 'Geyser replacement',
    propertyNickname: 'Oakwood Apartments',
    priority: 'high',
    status: 'in_progress',
    createdAt: '2026-07-20T00:00:00Z',
  },
];

/**
 * GET /owner-portal/maintenance (Phase 5, commercial-launch execution plan) -- read-only view of
 * maintenance activity on the caller's own properties (the "maintenance history" governance
 * requirement). `maintenance_tickets_select_staff_or_owner` (migration 20260101000072) already
 * scopes this. No create/edit capability here, deliberately -- ticket creation stays a staff
 * action (or the tenant-portal path), matching PERMISSIONS.md's read-mostly owner-portal posture.
 */
export default async function OwnerMaintenancePage() {
  const tickets = ADMIN_DEMO_MODE ? DEMO_TICKETS : await loadOwnerMaintenanceTickets();

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title="Maintenance" subtitle="Maintenance activity on your properties." />

      {tickets.length === 0 ? (
        <div className="rounded-card border border-light-border bg-light-surfaceRaised dark:border-dark-border dark:bg-dark-surfaceRaised">
          <EmptyState
            icon={<Wrench size={20} aria-hidden="true" />}
            title="No maintenance activity"
            description="Maintenance requests and their status for your properties will appear here."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-light-border bg-light-surfaceStrong dark:border-dark-border dark:bg-dark-surfaceStrong">
              <tr>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Summary</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Property</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Priority</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Status</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Logged</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-b border-light-border last:border-b-0 dark:border-dark-border">
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">{t.summary}</td>
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">{t.propertyNickname ?? '—'}</td>
                  <td className="px-4 py-3 capitalize text-light-textPrimary dark:text-dark-textPrimary">{t.priority}</td>
                  <td className="px-4 py-3 capitalize text-light-textPrimary dark:text-dark-textPrimary">{t.status.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                    {new Date(t.createdAt).toLocaleDateString('en-ZA')}
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

async function loadOwnerMaintenanceTickets(): Promise<OwnerMaintenanceRow[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('maintenance_tickets')
    .select('id, summary, priority, status, created_at, properties(nickname)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load maintenance tickets: ${error.message}`);

  return (data ?? []).map((row) => {
    const property = row.properties as unknown as { nickname: string } | null;
    return {
      id: row.id as string,
      summary: row.summary as string,
      propertyNickname: property?.nickname ?? null,
      priority: row.priority as string,
      status: row.status as string,
      createdAt: row.created_at as string,
    };
  });
}
