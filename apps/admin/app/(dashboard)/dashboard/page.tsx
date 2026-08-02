import Link from 'next/link';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { Button } from '@/components/ui/Button';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

// Owner Dashboard (priority 7, TASKS.md M20) -- the landing page a client-org user reaches after
// '/' resolves their portal session (apps/admin/app/page.tsx, fixed alongside this to actually
// route them here at all -- see DECISIONS.md 2026-08-01). KPI row matches
// PROPVIEW_SCREENSHOT_AUDIT.md's evidenced Dashboard exactly: "0 Properties", "0% Units occupied",
// "+R0 Cash left this month", "0 Units available".

interface DashboardData {
  totalProperties: number;
  occupancyPct: number;
  cashThisMonth: number;
  vacantUnits: number;
}

export default async function DashboardPage() {
  const data: DashboardData = ADMIN_DEMO_MODE
    ? { totalProperties: 1, occupancyPct: 100, cashThisMonth: 10650, vacantUnits: 0 }
    : await loadData();

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">Dashboard</h1>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        Your portfolio at a glance.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <AdminMetricCard label="Properties" value={data.totalProperties} />
        <AdminMetricCard label="Units occupied" value={`${data.occupancyPct}%`} />
        <AdminMetricCard
          label="Cash left this month"
          value={`${data.cashThisMonth >= 0 ? '+' : ''}R${data.cashThisMonth.toLocaleString('en-ZA')}`}
          hint="Rent collected minus expenses recorded"
        />
        <AdminMetricCard label="Units available" value={data.vacantUnits} />
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">Quick links</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/properties">
            <Button size="sm">Properties</Button>
          </Link>
          <Link href="/units">
            <Button size="sm">Units</Button>
          </Link>
          <Link href="/tenants">
            <Button size="sm">Tenants</Button>
          </Link>
          <Link href="/maintenance">
            <Button size="sm">Maintenance</Button>
          </Link>
          <Link href="/reports">
            <Button size="sm">Reports</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

async function loadData(): Promise<DashboardData> {
  const supabase = await getServerSupabaseClient();

  const [propertiesResult, unitsResult, rentSchedulesResult, expensesResult] = await Promise.all([
    supabase.from('properties').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('units').select('id, status'),
    supabase.from('rent_schedules').select('due_date, amount, status'),
    supabase.from('expenses').select('created_at, amount, status'),
  ]);
  if (propertiesResult.error) throw new Error(`Failed to load properties: ${propertiesResult.error.message}`);
  if (unitsResult.error) throw new Error(`Failed to load units: ${unitsResult.error.message}`);
  if (rentSchedulesResult.error) throw new Error(`Failed to load rent schedule: ${rentSchedulesResult.error.message}`);
  if (expensesResult.error) throw new Error(`Failed to load expenses: ${expensesResult.error.message}`);

  const units = unitsResult.data ?? [];
  const occupied = units.filter((u) => u.status === 'occupied').length;
  const vacantUnits = units.filter((u) => u.status === 'vacant').length;
  const occupancyPct = units.length > 0 ? Math.round((occupied / units.length) * 100) : 0;

  const thisMonthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const income = (rentSchedulesResult.data ?? [])
    .filter((r) => r.status === 'paid' && r.due_date.slice(0, 7) === thisMonthKey)
    .reduce((sum, r) => sum + Number(r.amount), 0);
  const expense = (expensesResult.data ?? [])
    .filter((e) => (e.status === 'recorded' || e.status === 'reimbursed') && e.created_at.slice(0, 7) === thisMonthKey)
    .reduce((sum, e) => sum + Number(e.amount), 0);

  return {
    totalProperties: propertiesResult.count ?? 0,
    occupancyPct,
    cashThisMonth: income - expense,
    vacantUnits,
  };
}
