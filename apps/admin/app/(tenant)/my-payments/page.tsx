import type { RentSchedule } from '@propvault/types';
import { RENT_SCHEDULE_STATUS_PRESENTATION } from '@propvault/ui';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolveTenantSession, getTenancyLeaseIds } from '@/lib/tenantSession';
import { mapRentScheduleRow, calculateOutstandingRentTotal } from '@/lib/leasing';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_RENT_SCHEDULES: RentSchedule[] = [
  {
    id: 'demo-tenant-rs-1',
    orgId: 'demo-org-1',
    leaseId: 'demo-tenant-lease-1',
    dueDate: '2026-08-01',
    amount: 10650,
    status: 'pending',
    generatedAt: '2026-07-25T00:00:00Z',
  },
  {
    id: 'demo-tenant-rs-2',
    orgId: 'demo-org-1',
    leaseId: 'demo-tenant-lease-1',
    dueDate: '2026-07-01',
    amount: 10650,
    status: 'paid',
    generatedAt: '2026-06-25T00:00:00Z',
  },
];

/** GET /my-payments — tenant portal (V1 scope correction, 2026-08-01, DECISIONS.md). */
export default async function MyPaymentsPage() {
  const rentSchedules = ADMIN_DEMO_MODE ? DEMO_RENT_SCHEDULES : await loadRentSchedules();
  const outstanding = calculateOutstandingRentTotal(rentSchedules);

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title="My Payments" subtitle="Your rent payment schedule and history." />

      <div className="max-w-xs">
        <AdminMetricCard
          label="Outstanding balance"
          value={`R${outstanding.toLocaleString('en-ZA')}`}
        />
      </div>

      {rentSchedules.length === 0 ? (
        <EmptyState icon={<span className="text-lg">💵</span>} title="No payment schedule yet" />
      ) : (
        <div className="overflow-x-auto rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-light-border bg-light-surfaceStrong dark:border-dark-border dark:bg-dark-surfaceStrong">
              <tr>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Due date
                </th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Amount
                </th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rentSchedules
                .slice()
                .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
                .map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-light-border last:border-0 dark:border-dark-border"
                  >
                    <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                      {r.dueDate}
                    </td>
                    <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                      R{Number(r.amount).toLocaleString('en-ZA')}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge presentation={RENT_SCHEDULE_STATUS_PRESENTATION[r.status]} />
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

async function loadRentSchedules(): Promise<RentSchedule[]> {
  const supabase = await getServerSupabaseClient();
  const session = await resolveTenantSession();
  if (!session) return [];

  // Multi-tenancy scoping (WORKLOG.md this date): the active tenancy's own lease history, never
  // payment history aggregated in from another tenancy the same Auth user also happens to hold.
  const leaseIds = await getTenancyLeaseIds(supabase, session.tenantId);
  if (leaseIds.length === 0) return [];

  const { data, error } = await supabase
    .from('rent_schedules')
    .select('*')
    .in('lease_id', leaseIds)
    .order('due_date', { ascending: false });
  if (error) throw new Error(`Failed to load payments: ${error.message}`);
  return (data ?? []).map(mapRentScheduleRow);
}
