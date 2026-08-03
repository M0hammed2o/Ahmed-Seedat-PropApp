import Link from 'next/link';
import type { RentSchedule, RentScheduleStatus } from '@propvault/types';
import { RENT_SCHEDULE_STATUSES } from '@propvault/types';
import { RentDueClient } from '@/components/accounting/RentDueClient';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership, canPostAccountingRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type SearchParams = { searchParams: Promise<{ status?: string }> };

const DEMO_RENT_SCHEDULE: RentSchedule[] = [
  {
    id: 'demo-rent-schedule-1',
    orgId: 'demo-org-1',
    leaseId: 'demo-lease-1',
    dueDate: '2026-09-01',
    amount: 12500,
    status: 'pending',
    generatedAt: '2026-08-01T00:00:00Z',
  },
];

/**
 * GET /accounting/rent-due -- first Accounting-module page (TASKS.md M20/M14), matching
 * PROPVIEW_SCREENSHOT_AUDIT.md's FINANCE nav section's "Rent Due" item. Direct RLS-scoped read
 * of rent_schedules (same pattern every list page this milestone uses), with a status filter
 * (?status=) mirroring GET /api/v1/rent-schedules' own query param. Issuing an invoice
 * (accountant+ only, PERMISSIONS.md's Accounting (post) column) is the one write action here.
 */
export default async function RentDuePage({ searchParams }: SearchParams) {
  const { status } = await searchParams;
  const statusFilter = status && (RENT_SCHEDULE_STATUSES as readonly string[]).includes(status) ? status : undefined;

  const rentSchedule: RentSchedule[] = ADMIN_DEMO_MODE
    ? DEMO_RENT_SCHEDULE.filter((r) => !statusFilter || r.status === statusFilter)
    : await loadRentSchedule(statusFilter as RentScheduleStatus | undefined);

  const canPost = ADMIN_DEMO_MODE ? true : await resolveCanPost();

  const pending = rentSchedule.filter((r) => r.status === 'pending').length;
  const overdue = rentSchedule.filter((r) => r.status === 'overdue').length;
  const paid = rentSchedule.filter((r) => r.status === 'paid').length;

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Rent Due"
        subtitle="Rent schedule rows across your portfolio, generated automatically when a lease is approved."
      />

      <div className="grid grid-cols-3 gap-4">
        <AdminMetricCard label="Pending" value={pending} />
        <AdminMetricCard label="Overdue" value={overdue} />
        <AdminMetricCard label="Paid" value={paid} />
      </div>

      <div className="flex gap-2">
        <FilterLink label="All" active={!statusFilter} href="/accounting/rent-due" />
        {RENT_SCHEDULE_STATUSES.map((s) => (
          <FilterLink key={s} label={s} active={statusFilter === s} href={`/accounting/rent-due?status=${s}`} />
        ))}
      </div>

      <RentDueClient data={rentSchedule} canPost={canPost} />
    </div>
  );
}

function FilterLink({ label, active, href }: { label: string; active: boolean; href: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs capitalize ${
        active
          ? 'border-light-accent bg-light-accent/10 text-light-accent dark:border-dark-accent dark:bg-dark-accent/10 dark:text-dark-accent'
          : 'border-light-border text-light-textSecondary dark:border-dark-border dark:text-dark-textSecondary'
      }`}
    >
      {label}
    </Link>
  );
}

async function loadRentSchedule(status?: RentScheduleStatus): Promise<RentSchedule[]> {
  const supabase = await getServerSupabaseClient();
  let query = supabase.from('rent_schedules').select('*').order('due_date', { ascending: true });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load rent schedule: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    orgId: row.org_id,
    leaseId: row.lease_id,
    dueDate: row.due_date,
    amount: row.amount,
    status: row.status as RentSchedule['status'],
    generatedAt: row.generated_at,
  }));
}

async function resolveCanPost(): Promise<boolean> {
  const session = await resolvePortalSession();
  if (!session) return false;
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) return false;
  const membership = findActiveMembership(session, activeOrg.orgId);
  return Boolean(membership && canPostAccountingRecords(membership.role));
}
