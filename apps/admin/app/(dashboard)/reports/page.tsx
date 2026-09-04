import Link from 'next/link';
import { Download } from 'lucide-react';
import { MAINTENANCE_STATUSES, RENT_SCHEDULE_STATUSES, type OwnerFinancialSummary } from '@propvault/types';
import { MiniBarChart } from '@/components/ui/MiniBarChart';
import { MiniLineChart } from '@/components/ui/MiniLineChart';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { resolvePortalSession } from '@/lib/orgSession';
import { resolveSummaryMonth, resolvePeriodRange } from '@/lib/dashboardKpis';
import { loadPortfolioFinancialOverview } from '@/lib/financialOverview';
import { FinancialOverviewSection } from '@/components/dashboard/FinancialOverviewSection';

function currency(n: number): string {
  return `R${Math.round(n).toLocaleString('en-ZA')}`;
}

// Real destinations only -- Lovable's "Report library" lists 8 fixed report names (Rent roll,
// Arrears ageing, Lease expiry, Vacancy analysis, Owner statements, Maintenance log, Tax summary,
// Portfolio valuation); only 4 have a real, already-built page behind them in this codebase. The
// other 4 are omitted rather than linked to a page that doesn't exist or relabelled to something
// that overstates what the real page actually shows.
const REPORT_LIBRARY = [
  { label: 'Rent Due', href: '/accounting/rent-due' },
  { label: 'Owner Statements', href: '/accounting/owner-statements' },
  { label: 'Trial Balance', href: '/accounting/trial-balance' },
  { label: 'Tax Pack', href: '/accounting/tax-pack' },
];

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

  const stats = [
    { label: 'Revenue YTD', value: currency(data.stats.revenueYtd) },
    { label: 'Avg. occupancy', value: `${data.stats.avgOccupancyPct}%` },
    { label: 'Collection rate', value: `${data.stats.collectionRatePct}%` },
    { label: 'Maintenance spend YTD', value: currency(data.stats.maintenanceSpendYtd) },
  ];

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title="Reports" subtitle="A snapshot across your portfolio." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="panel px-5 py-4">
            <p className="text-[11px] text-light-textMuted dark:text-dark-textMuted">{s.label}</p>
            <p className="tabular mt-1.5 font-display text-[22px] font-bold text-light-textPrimary dark:text-dark-textPrimary">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Web financials V1 pass, part 2 (WORKLOG.md this date): Reports previously computed its
          own income/expense figures independently of Dashboard/Property Finances (raw
          rent_schedules/expenses queries, bucketed by created_at rather than invoice_date, no
          rates/levies/utilities split at all) -- the exact "multiple independent definitions of
          the same concept" the task's own audit flagged. This reuses the SAME
          FinancialOverviewSection component, fed by the SAME loadPortfolioFinancialOverview() call
          the dashboard uses, for the current month -- by construction, Reports and Dashboard show
          identical rent/utilities/rates & taxes/levies/other/total/operating-position figures for
          the same org+month. The chart panels below (6-month trend, occupancy, etc.) are a
          different, genuinely distinct concept (a portfolio-wide history/breakdown) and are left as
          they were. */}
      <FinancialOverviewSection
        summary={data.financialOverview}
        monthLabel={data.financialOverviewMonthLabel}
        periodLabel={data.financialOverviewMonthLabel}
        manageBudgetHref="/budget"
        manageUtilitiesHref="/properties"
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Income vs Expense Trend">
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
                <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
                  Income (rent paid)
                </p>
                <MiniLineChart
                  points={data.incomeExpense.map((p) => ({ label: p.label, value: p.income }))}
                />
              </div>
              <div>
                <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
                  Expenses (recorded)
                </p>
                <MiniLineChart
                  points={data.incomeExpense.map((p) => ({ label: p.label, value: p.expense }))}
                  color="#B3541E"
                />
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Occupancy by Property">
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
            <MiniBarChart
              bars={data.occupancy.map((o) => ({ label: o.label, value: o.occupiedPct }))}
            />
          )}
        </Panel>

        <Panel title="Tenant Payment Status">
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
        </Panel>

        <Panel title="Maintenance by Status">
          {data.maintenanceStatusCounts.every((c) => c.value === 0) ? (
            <EmptyState
              icon={<span className="text-lg">🔧</span>}
              title="No maintenance tickets yet"
            />
          ) : (
            <MiniBarChart bars={data.maintenanceStatusCounts} color="#7A5CC7" />
          )}
        </Panel>

        <Panel title="Report library" bodyClassName="p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {REPORT_LIBRARY.map((r) => (
              <Link
                key={r.label}
                href={r.href}
                className="flex items-center justify-between rounded-xl border border-light-border px-4 py-3 text-left text-[13px] font-medium text-light-textPrimary transition-colors hover:bg-light-surface dark:border-dark-border dark:text-dark-textPrimary dark:hover:bg-dark-surface"
              >
                {r.label}{' '}
                <Download
                  className="h-4 w-4 text-light-textMuted dark:text-dark-textMuted"
                  aria-hidden="true"
                />
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

interface ReportsData {
  incomeExpense: { label: string; income: number; expense: number }[];
  occupancy: { label: string; occupiedPct: number }[];
  rentStatusCounts: { label: string; value: number }[];
  maintenanceStatusCounts: { label: string; value: number }[];
  stats: {
    revenueYtd: number;
    avgOccupancyPct: number;
    collectionRatePct: number;
    maintenanceSpendYtd: number;
  };
  financialOverview: OwnerFinancialSummary | null;
  financialOverviewMonthLabel: string;
}

function demoData(): ReportsData {
  const months = lastNMonthKeys(6).map((k) => k.slice(5));
  return {
    incomeExpense: months.map((m, i) => ({
      label: m,
      income: i === months.length - 1 ? 12500 : 0,
      expense: i === months.length - 1 ? 1850 : 0,
    })),
    occupancy: [{ label: 'Sea Point Apart…', occupiedPct: 100 }],
    rentStatusCounts: RENT_SCHEDULE_STATUSES.map((s) => ({
      label: s,
      value: s === 'pending' ? 1 : 0,
    })),
    maintenanceStatusCounts: MAINTENANCE_STATUSES.map((s) => ({
      label: s.replace('_', ' '),
      value: s === 'to_do' ? 1 : 0,
    })),
    stats: {
      revenueYtd: 84500,
      avgOccupancyPct: 92,
      collectionRatePct: 94,
      maintenanceSpendYtd: 1850,
    },
    financialOverviewMonthLabel: 'August 2026',
    financialOverview: {
      propertyId: null,
      propertyCount: 4,
      month: '2026-08-01',
      rentPlanned: 90700,
      rentCollected: 84500,
      rentOutstanding: 6200,
      utilitiesExpense: 2850,
      waterExpense: 1650,
      electricityExpense: 1200,
      ratesAndLeviesExpense: 3100,
      ratesTaxesExpense: 1950,
      leviesExpense: 1150,
      otherExpenses: 1450,
      totalExpenses: 7400,
      budgetPlanned: 9000,
      budgetUsedPercent: 82.2,
      budgetRemaining: 1600,
      netOperatingPosition: 77100,
      awaitingConfirmationCount: 1,
      budgetAlerts: [],
      utilityAnomalyAlerts: [],
    },
  };
}

async function loadData(): Promise<ReportsData> {
  const supabase = await getServerSupabaseClient();
  const monthKeys = lastNMonthKeys(6);
  const yearStart = `${new Date().getFullYear()}-01-01`;

  const [
    propertiesResult,
    unitsResult,
    rentSchedulesResult,
    expensesResult,
    maintenanceResult,
    vendorBillsResult,
  ] = await Promise.all([
    supabase.from('properties').select('id, nickname').eq('status', 'active'),
    supabase.from('units').select('id, property_id, status'),
    supabase.from('rent_schedules').select('due_date, amount, status'),
    supabase.from('expenses').select('created_at, amount, status'),
    supabase.from('maintenance_tickets').select('status'),
    supabase
      .from('vendor_bills')
      .select('amount, status, created_at')
      .not('maintenance_ticket_id', 'is', null)
      .gte('created_at', yearStart),
  ]);
  if (propertiesResult.error)
    throw new Error(`Failed to load properties: ${propertiesResult.error.message}`);
  if (unitsResult.error) throw new Error(`Failed to load units: ${unitsResult.error.message}`);
  if (rentSchedulesResult.error)
    throw new Error(`Failed to load rent schedule: ${rentSchedulesResult.error.message}`);
  if (expensesResult.error)
    throw new Error(`Failed to load expenses: ${expensesResult.error.message}`);
  if (maintenanceResult.error)
    throw new Error(`Failed to load maintenance tickets: ${maintenanceResult.error.message}`);
  if (vendorBillsResult.error)
    throw new Error(`Failed to load vendor bills: ${vendorBillsResult.error.message}`);

  const incomeByMonth = new Map(monthKeys.map((k) => [k, 0]));
  for (const row of rentSchedulesResult.data ?? []) {
    if (row.status !== 'paid') continue;
    const key = row.due_date.slice(0, 7);
    if (incomeByMonth.has(key))
      incomeByMonth.set(key, (incomeByMonth.get(key) ?? 0) + Number(row.amount));
  }
  const expenseByMonth = new Map(monthKeys.map((k) => [k, 0]));
  for (const row of expensesResult.data ?? []) {
    if (row.status !== 'recorded' && row.status !== 'reimbursed') continue;
    const key = row.created_at.slice(0, 7);
    if (expenseByMonth.has(key))
      expenseByMonth.set(key, (expenseByMonth.get(key) ?? 0) + Number(row.amount));
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
    return {
      label: p.nickname.length > 14 ? `${p.nickname.slice(0, 13)}…` : p.nickname,
      occupiedPct: pct,
    };
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

  const ytdRentRows = rentRows.filter((r) => r.due_date >= yearStart);
  const revenueYtd = ytdRentRows
    .filter((r) => r.status === 'paid')
    .reduce((sum, r) => sum + Number(r.amount), 0);
  const billedYtd = ytdRentRows.reduce((sum, r) => sum + Number(r.amount), 0);
  const collectionRatePct = billedYtd > 0 ? Math.round((revenueYtd / billedYtd) * 100) : 0;

  const totalUnits = units.length;
  const totalOccupied = units.filter((u) => u.status === 'occupied').length;
  const avgOccupancyPct = totalUnits > 0 ? Math.round((totalOccupied / totalUnits) * 100) : 0;

  const maintenanceSpendYtd = (vendorBillsResult.data ?? [])
    .filter((b) => b.status === 'paid')
    .reduce((sum, b) => sum + Number(b.amount), 0);

  // Web financials V1 pass, part 2 (WORKLOG.md this date): the one authoritative financial
  // summary, same source Dashboard's own FinancialOverviewSection uses -- current month, portfolio-
  // wide (Reports has no property filter of its own).
  const session = await resolvePortalSession();
  const activeOrgId = session?.organizations.find((m) => m.status === 'active')?.orgId;
  const { month: summaryMonth, monthLabel: financialOverviewMonthLabel } = resolveSummaryMonth(
    resolvePeriodRange('this_month', {}, new Date()),
  );
  const financialOverview = activeOrgId
    ? await loadPortfolioFinancialOverview(supabase, activeOrgId, summaryMonth)
    : null;

  return {
    incomeExpense,
    occupancy,
    rentStatusCounts,
    maintenanceStatusCounts,
    stats: { revenueYtd, avgOccupancyPct, collectionRatePct, maintenanceSpendYtd },
    financialOverview,
    financialOverviewMonthLabel,
  };
}
