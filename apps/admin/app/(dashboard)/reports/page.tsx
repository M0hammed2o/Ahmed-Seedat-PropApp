import type { ReactNode } from 'react';
import Link from 'next/link';
import { MAINTENANCE_STATUSES, RENT_SCHEDULE_STATUSES } from '@propvault/types';
import { MiniBarChart } from '@/components/ui/MiniBarChart';
import { MiniLineChart } from '@/components/ui/MiniLineChart';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

// 4 report cards, matching PROPVIEW_SCREENSHOT_AUDIT.md's evidenced Reports module exactly
// (IMG_7991-7995): Income vs Expense Trend, Occupancy by Property, Tenant Payment Status,
// Maintenance by Status -- each with a matching empty state + CTA. Deliberately simple,
// dependency-free charts (MiniBarChart/MiniLineChart, already used by the Super Admin overview
// dashboard) rather than a charting library, and month-bucketed rent_schedules/expenses sums
// rather than a full journal_lines/chart_of_accounts join -- a V1-appropriate approximation of
// "income vs expense," not a general ledger report (that's Trial Balance's job).

function monthLabel(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-ZA', { month: 'short' });
}

function lastNMonthKeys(n: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

export default async function ReportsPage() {
  const data = ADMIN_DEMO_MODE ? demoData() : await loadData();

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">Reports</h1>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        A snapshot across your portfolio.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ReportCard title="Income vs Expense Trend">
          {data.incomeExpense.every((p) => p.income === 0 && p.expense === 0) ? (
            <EmptyState
              icon={<span className="text-lg">📈</span>}
              title="No rent or expenses recorded yet"
              action={
                <Link href="/accounting/rent-due">
                  <Button size="sm">+ Open Rent Due</Button>
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-light-textMuted dark:text-dark-textMuted">Income (rent paid)</p>
                <MiniLineChart points={data.incomeExpense.map((p) => ({ label: p.label, value: p.income }))} />
              </div>
              <div>
                <p className="text-xs text-light-textMuted dark:text-dark-textMuted">Expenses (recorded)</p>
                <MiniLineChart
                  points={data.incomeExpense.map((p) => ({ label: p.label, value: p.expense }))}
                  color="#B3541E"
                />
              </div>
            </div>
          )}
        </ReportCard>

        <ReportCard title="Occupancy by Property">
          {data.occupancy.length === 0 ? (
            <EmptyState
              icon={<span className="text-lg">🏠</span>}
              title="No properties yet"
              action={
                <Link href="/properties/new">
                  <Button size="sm">+ Add property</Button>
                </Link>
              }
            />
          ) : (
            <MiniBarChart bars={data.occupancy.map((o) => ({ label: o.label, value: o.occupiedPct }))} />
          )}
        </ReportCard>

        <ReportCard title="Tenant Payment Status">
          {data.rentStatusCounts.every((c) => c.value === 0) ? (
            <EmptyState
              icon={<span className="text-lg">🧾</span>}
              title="No tenants yet"
              action={
                <Link href="/tenants/new">
                  <Button size="sm">+ Add tenant</Button>
                </Link>
              }
            />
          ) : (
            <MiniBarChart bars={data.rentStatusCounts} color="#2F5D50" />
          )}
        </ReportCard>

        <ReportCard title="Maintenance by Status">
          {data.maintenanceStatusCounts.every((c) => c.value === 0) ? (
            <EmptyState icon={<span className="text-lg">🔧</span>} title="No maintenance tickets yet" />
          ) : (
            <MiniBarChart bars={data.maintenanceStatusCounts} color="#7A5CC7" />
          )}
        </ReportCard>
      </div>
    </div>
  );
}

function ReportCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-light-border p-5 dark:border-dark-border">
      <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

interface ReportsData {
  incomeExpense: { label: string; income: number; expense: number }[];
  occupancy: { label: string; occupiedPct: number }[];
  rentStatusCounts: { label: string; value: number }[];
  maintenanceStatusCounts: { label: string; value: number }[];
}

function demoData(): ReportsData {
  const months = lastNMonthKeys(6).map((k) => k.slice(5));
  return {
    incomeExpense: months.map((m, i) => ({ label: m, income: i === months.length - 1 ? 12500 : 0, expense: i === months.length - 1 ? 1850 : 0 })),
    occupancy: [{ label: 'Sea Point Apart…', occupiedPct: 100 }],
    rentStatusCounts: RENT_SCHEDULE_STATUSES.map((s) => ({ label: s, value: s === 'pending' ? 1 : 0 })),
    maintenanceStatusCounts: MAINTENANCE_STATUSES.map((s) => ({ label: s.replace('_', ' '), value: s === 'to_do' ? 1 : 0 })),
  };
}

async function loadData(): Promise<ReportsData> {
  const supabase = await getServerSupabaseClient();
  const monthKeys = lastNMonthKeys(6);

  const [propertiesResult, unitsResult, rentSchedulesResult, expensesResult, maintenanceResult] = await Promise.all([
    supabase.from('properties').select('id, nickname').eq('status', 'active'),
    supabase.from('units').select('id, property_id, status'),
    supabase.from('rent_schedules').select('due_date, amount, status'),
    supabase.from('expenses').select('created_at, amount, status'),
    supabase.from('maintenance_tickets').select('status'),
  ]);
  if (propertiesResult.error) throw new Error(`Failed to load properties: ${propertiesResult.error.message}`);
  if (unitsResult.error) throw new Error(`Failed to load units: ${unitsResult.error.message}`);
  if (rentSchedulesResult.error) throw new Error(`Failed to load rent schedule: ${rentSchedulesResult.error.message}`);
  if (expensesResult.error) throw new Error(`Failed to load expenses: ${expensesResult.error.message}`);
  if (maintenanceResult.error) throw new Error(`Failed to load maintenance tickets: ${maintenanceResult.error.message}`);

  const incomeByMonth = new Map(monthKeys.map((k) => [k, 0]));
  for (const row of rentSchedulesResult.data ?? []) {
    if (row.status !== 'paid') continue;
    const key = row.due_date.slice(0, 7);
    if (incomeByMonth.has(key)) incomeByMonth.set(key, (incomeByMonth.get(key) ?? 0) + Number(row.amount));
  }
  const expenseByMonth = new Map(monthKeys.map((k) => [k, 0]));
  for (const row of expensesResult.data ?? []) {
    if (row.status !== 'recorded' && row.status !== 'reimbursed') continue;
    const key = row.created_at.slice(0, 7);
    if (expenseByMonth.has(key)) expenseByMonth.set(key, (expenseByMonth.get(key) ?? 0) + Number(row.amount));
  }
  const incomeExpense = monthKeys.map((k) => ({
    label: monthLabel(`${k}-01`),
    income: incomeByMonth.get(k) ?? 0,
    expense: expenseByMonth.get(k) ?? 0,
  }));

  const properties = propertiesResult.data ?? [];
  const units = unitsResult.data ?? [];
  const occupancy = properties.map((p) => {
    const propertyUnits = units.filter((u) => u.property_id === p.id);
    const occupied = propertyUnits.filter((u) => u.status === 'occupied').length;
    const pct = propertyUnits.length > 0 ? Math.round((occupied / propertyUnits.length) * 100) : 0;
    return { label: p.nickname.length > 14 ? `${p.nickname.slice(0, 13)}…` : p.nickname, occupiedPct: pct };
  });

  const rentRows = rentSchedulesResult.data ?? [];
  const rentStatusCounts = RENT_SCHEDULE_STATUSES.map((s) => ({
    label: s,
    value: rentRows.filter((r) => r.status === s).length,
  }));

  const maintenanceRows = maintenanceResult.data ?? [];
  const maintenanceStatusCounts = MAINTENANCE_STATUSES.map((s) => ({
    label: s.replace('_', ' '),
    value: maintenanceRows.filter((m) => m.status === s).length,
  }));

  return { incomeExpense, occupancy, rentStatusCounts, maintenanceStatusCounts };
}
