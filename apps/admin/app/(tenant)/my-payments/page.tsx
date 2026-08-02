import type { RentSchedule } from '@propvault/types';
import { RENT_SCHEDULE_STATUS_PRESENTATION } from '@propvault/ui';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapRentScheduleRow } from '@/lib/leasing';
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
  const outstanding = rentSchedules
    .filter((r) => r.status === 'pending' || r.status === 'overdue')
    .reduce((sum, r) => sum + Number(r.amount), 0);

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">My Payments</h1>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        Your rent payment schedule and history.
      </p>

      <div className="mt-6 max-w-xs">
        <AdminMetricCard label="Outstanding balance" value={`R${outstanding.toLocaleString('en-ZA')}`} />
      </div>

      {rentSchedules.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={<span className="text-lg">💵</span>} title="No payment schedule yet" />
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-light-border dark:border-dark-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-light-border bg-light-surfaceRaised dark:border-dark-border dark:bg-dark-surfaceRaised">
              <tr>
                <th className="px-4 py-2 font-medium text-light-textMuted dark:text-dark-textMuted">Due date</th>
                <th className="px-4 py-2 font-medium text-light-textMuted dark:text-dark-textMuted">Amount</th>
                <th className="px-4 py-2 font-medium text-light-textMuted dark:text-dark-textMuted">Status</th>
              </tr>
            </thead>
            <tbody>
              {rentSchedules
                .slice()
                .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
                .map((r) => (
                  <tr key={r.id} className="border-b border-light-border last:border-0 dark:border-dark-border">
                    <td className="px-4 py-2 text-light-textPrimary dark:text-dark-textPrimary">{r.dueDate}</td>
                    <td className="px-4 py-2 text-light-textPrimary dark:text-dark-textPrimary">
                      R{Number(r.amount).toLocaleString('en-ZA')}
                    </td>
                    <td className="px-4 py-2">
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
  const { data, error } = await supabase.from('rent_schedules').select('*').order('due_date', { ascending: false });
  if (error) throw new Error(`Failed to load payments: ${error.message}`);
  return (data ?? []).map(mapRentScheduleRow);
}
