import Link from 'next/link';
import { Download, Receipt as ReceiptIcon } from 'lucide-react';
import { INVOICE_STATUS_PRESENTATION } from '@propvault/ui';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapExpenseRow, mapInvoiceRow } from '@/lib/accounting';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Delta } from '@/components/ui/Delta';
import { MoneyFlowChart } from '@/components/dashboard/MoneyFlowChart';
import { CollectionsMixChart } from '@/components/dashboard/CollectionsMixChart';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

// New page -- Lovable's reference (reference/lovable-ui-reference/.../src/routes/accounting/
// index.tsx) has one combined Accounting overview; PropertyVault had no landing route above its 7
// real Finance sub-pages (Rent Due/Expenses/Bank Accounts/Bank Transactions/Owner Statements/
// Trial Balance/Tax Pack) until this batch. Adopts Lovable's overview composition (stat row, cash
// flow chart, expense mix, invoices, payments received) as the new /accounting landing page, wired
// to real data throughout -- confirmed via AskUserQuestion with Mohammed (2026-08-04) rather than
// guessed, since this is a new route/nav entry, not a reskin of an existing one.

const CHART_TONES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

interface MoneySeriesPoint {
  month: string;
  billed: number;
  collected: number;
  expenses: number;
}

interface InvoiceRow {
  id: string;
  tenantName: string;
  period: string;
  amount: number;
  status: 'draft' | 'issued' | 'paid';
}

interface PaymentRow {
  id: string;
  tenantName: string;
  amount: number;
  date: string;
}

interface AccountingOverview {
  incomeMtd: number;
  incomeDelta: number | null;
  expensesMtd: number;
  expensesDelta: number | null;
  netCashFlow: number;
  netCashFlowDelta: number | null;
  outstandingRent: number;
  outstandingDelta: number | null;
  revenueSeries: MoneySeriesPoint[];
  expenseMix: { name: string; value: number; tone: string }[];
  invoices: InvoiceRow[];
  payments: PaymentRow[];
}

const DEMO_DATA: AccountingOverview = {
  incomeMtd: 84500,
  incomeDelta: 1.8,
  expensesMtd: 7400,
  expensesDelta: -3.1,
  netCashFlow: 77100,
  netCashFlowDelta: 4.6,
  outstandingRent: 6200,
  outstandingDelta: -2.1,
  revenueSeries: [
    { month: 'Dec', billed: 82000, collected: 78000, expenses: 12400 },
    { month: 'Jan', billed: 85500, collected: 81500, expenses: 9800 },
    { month: 'Feb', billed: 83200, collected: 79200, expenses: 15200 },
    { month: 'Mar', billed: 87000, collected: 83000, expenses: 8600 },
    { month: 'Apr', billed: 86100, collected: 82100, expenses: 11300 },
    { month: 'May', billed: 88500, collected: 84500, expenses: 7400 },
    { month: 'Jun', billed: 89200, collected: 85000, expenses: 9200 },
    { month: 'Jul', billed: 90000, collected: 86300, expenses: 10100 },
    { month: 'Aug', billed: 90700, collected: 84500, expenses: 7400 },
  ],
  expenseMix: [
    { name: 'Maintenance', value: 42, tone: CHART_TONES[0]! },
    { name: 'Levies', value: 28, tone: CHART_TONES[1]! },
    { name: 'Insurance', value: 18, tone: CHART_TONES[2]! },
    { name: 'Utilities', value: 12, tone: CHART_TONES[3]! },
  ],
  invoices: [
    {
      id: 'demo-inv-1',
      tenantName: 'Naledi Khumalo',
      period: '2026-08-01',
      amount: 12500,
      status: 'paid',
    },
  ],
  payments: [{ id: 'demo-pmt-1', tenantName: 'Naledi Khumalo', amount: 12500, date: '2026-08-01' }],
};

function currency(n: number, compact = false): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: compact ? 1 : 0,
    notation: compact ? 'compact' : 'standard',
  }).format(n);
}

export default async function AccountingOverviewPage() {
  const data = ADMIN_DEMO_MODE ? DEMO_DATA : await loadData();
  const monthLabel = new Date().toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });

  const stats = [
    { label: 'Income (MTD)', value: currency(data.incomeMtd), delta: data.incomeDelta },
    { label: 'Expenses (MTD)', value: currency(data.expensesMtd), delta: data.expensesDelta },
    { label: 'Net cash flow', value: currency(data.netCashFlow), delta: data.netCashFlowDelta },
    {
      label: 'Outstanding rent',
      value: currency(data.outstandingRent),
      delta: data.outstandingDelta,
    },
  ];

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Accounting"
        subtitle={`${monthLabel} overview across your portfolio.`}
        actions={
          <>
            <Link href="/accounting/owner-statements">
              <Button variant="secondary" size="sm">
                <Download className="mr-1.5 h-4 w-4" aria-hidden="true" /> Owner statements
              </Button>
            </Link>
            {/* Lovable's "New invoice" opens an ad hoc creation form; PropertyVault has no such
                flow -- an invoice is only ever created by issuing a pending rent schedule
                (invoice_rent_schedule() RPC, wired into Rent Due and the Lease detail page). This
                links to the real place that happens instead of a fabricated destination. */}
            <Link href="/accounting/rent-due">
              <Button variant="primary" size="sm">
                <ReceiptIcon className="mr-1.5 h-4 w-4" aria-hidden="true" /> Issue invoice
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="panel px-5 py-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-light-textMuted dark:text-dark-textMuted">{s.label}</p>
              {s.delta !== null ? <Delta value={s.delta} /> : null}
            </div>
            <p className="tabular mt-1.5 font-display text-[22px] font-bold text-light-textPrimary dark:text-dark-textPrimary">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Cash flow"
          description="Last 9 months"
          bodyClassName="p-3 pt-5"
        >
          <MoneyFlowChart data={data.revenueSeries} />
        </Panel>

        <Panel title="Expense mix" description="Year to date" bodyClassName="p-4">
          {data.expenseMix.length > 0 ? (
            <CollectionsMixChart data={data.expenseMix} />
          ) : (
            <p className="px-1 py-6 text-center text-xs text-light-textMuted dark:text-dark-textMuted">
              No expenses recorded this year yet.
            </p>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Invoices" bodyClassName="p-0">
          {data.invoices.length > 0 ? (
            <table className="w-full text-left text-[13px]">
              <thead className="bg-light-surface text-[11px] tracking-wide text-light-textMuted uppercase dark:bg-dark-surface dark:text-dark-textMuted">
                <tr>
                  <th className="px-5 py-3 font-medium">Tenant</th>
                  <th className="px-5 py-3 font-medium">Period</th>
                  <th className="px-5 py-3 text-right font-medium">Amount</th>
                  <th className="px-5 py-3 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-light-border dark:divide-dark-border">
                {data.invoices.map((i) => (
                  <tr key={i.id} className="hover:bg-light-surface dark:hover:bg-dark-surface">
                    <td className="px-5 py-3 font-medium text-light-textPrimary dark:text-dark-textPrimary">
                      {i.tenantName}
                    </td>
                    <td className="px-5 py-3 text-light-textMuted dark:text-dark-textMuted">
                      {new Date(i.period).toLocaleDateString('en-ZA', {
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="tabular px-5 py-3 text-right font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                      {currency(i.amount)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <StatusBadge presentation={INVOICE_STATUS_PRESENTATION[i.status]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-5 py-8 text-center text-xs text-light-textMuted dark:text-dark-textMuted">
              No invoices issued yet.
            </p>
          )}
        </Panel>

        <Panel title="Payments received" bodyClassName="p-0">
          {data.payments.length > 0 ? (
            <ul className="divide-y divide-light-border dark:divide-dark-border">
              {data.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-light-textPrimary dark:text-dark-textPrimary">
                      {p.tenantName}
                    </p>
                    <p className="text-[11px] text-light-textMuted dark:text-dark-textMuted">
                      {new Date(p.date).toLocaleDateString('en-ZA', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <span className="tabular text-[13px] font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                    {currency(p.amount)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-xs text-light-textMuted dark:text-dark-textMuted">
              No matched payments yet.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

async function loadData(): Promise<AccountingOverview> {
  const supabase = await getServerSupabaseClient();
  const now = new Date();
  const yearStart = `${now.getFullYear()}-01-01`;

  const [rentSchedulesResult, expensesResult, invoicesResult, txResult] = await Promise.all([
    supabase.from('rent_schedules').select('due_date, amount, status'),
    supabase.from('expenses').select('*').gte('created_at', yearStart),
    supabase
      .from('invoices')
      .select('id, tenant_id, period, amount, status')
      .order('created_at', { ascending: false })
      .limit(6),
    supabase
      .from('bank_transactions')
      .select('id, amount, transaction_date, matched_rent_schedule_id')
      .eq('match_status', 'matched')
      .order('transaction_date', { ascending: false })
      .limit(6),
  ]);
  if (rentSchedulesResult.error)
    throw new Error(`Failed to load rent schedule: ${rentSchedulesResult.error.message}`);
  if (expensesResult.error)
    throw new Error(`Failed to load expenses: ${expensesResult.error.message}`);
  if (invoicesResult.error)
    throw new Error(`Failed to load invoices: ${invoicesResult.error.message}`);
  if (txResult.error)
    throw new Error(`Failed to load bank transactions: ${txResult.error.message}`);

  const rentSchedules = rentSchedulesResult.data ?? [];
  const expenses = (expensesResult.data ?? []).map(mapExpenseRow);

  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const thisMonthKey = monthKey(now);
  const lastMonthKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const billedInMonth = (key: string) =>
    rentSchedules
      .filter((r) => r.due_date.slice(0, 7) === key)
      .reduce((sum, r) => sum + Number(r.amount), 0);
  const collectedInMonth = (key: string) =>
    rentSchedules
      .filter((r) => r.status === 'paid' && r.due_date.slice(0, 7) === key)
      .reduce((sum, r) => sum + Number(r.amount), 0);
  const outstandingAsOf = (key: string) =>
    rentSchedules
      .filter(
        (r) =>
          (r.status === 'invoiced' || r.status === 'overdue' || r.status === 'partial') &&
          r.due_date.slice(0, 7) <= key,
      )
      .reduce((sum, r) => sum + Number(r.amount), 0);
  const expensesInMonth = (key: string) =>
    expenses
      .filter(
        (e) =>
          (e.status === 'recorded' || e.status === 'reimbursed') && e.createdAt.slice(0, 7) === key,
      )
      .reduce((sum, e) => sum + e.amount, 0);

  const pctDelta = (curr: number, prev: number): number | null => {
    if (prev === 0) return null; // No honest percentage change to compute from a zero base.
    return Math.round(((curr - prev) / prev) * 1000) / 10;
  };

  const incomeMtd = collectedInMonth(thisMonthKey);
  const incomeLastMonth = collectedInMonth(lastMonthKey);
  const expensesMtd = expensesInMonth(thisMonthKey);
  const expensesLastMonth = expensesInMonth(lastMonthKey);
  const outstandingRent = outstandingAsOf(thisMonthKey);
  const outstandingLastMonth = outstandingAsOf(lastMonthKey);
  const netCashFlow = incomeMtd - expensesMtd;
  const netCashFlowLastMonth = incomeLastMonth - expensesLastMonth;

  const revenueSeries: MoneySeriesPoint[] = Array.from({ length: 9 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (8 - i), 1);
    const key = monthKey(d);
    return {
      month: d.toLocaleDateString('en-ZA', { month: 'short' }),
      billed: billedInMonth(key),
      collected: collectedInMonth(key),
      expenses: expensesInMonth(key),
    };
  });

  // Free-text category (public.expenses.category has no fixed enum) -- grouped by whatever
  // categories this org has actually used, largest first, capped to 5 slices (matching
  // CollectionsMixChart's legend size) with the remainder folded into "Other" rather than an
  // unbounded, unreadable legend.
  const totalExpenseYtd = expenses
    .filter((e) => e.status === 'recorded' || e.status === 'reimbursed')
    .reduce((sum, e) => sum + e.amount, 0);
  const byCategory = new Map<string, number>();
  for (const e of expenses) {
    if (e.status !== 'recorded' && e.status !== 'reimbursed') continue;
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
  }
  const sortedCategories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const topCategories = sortedCategories.slice(0, 5);
  const otherTotal = sortedCategories.slice(5).reduce((sum, [, amount]) => sum + amount, 0);
  const expenseMix =
    totalExpenseYtd > 0
      ? [
          ...topCategories,
          ...(otherTotal > 0 ? [['Other', otherTotal] as [string, number]] : []),
        ].map(([name, amount], i) => ({
          name,
          value: Math.round((amount / totalExpenseYtd) * 100),
          tone: CHART_TONES[i % CHART_TONES.length]!,
        }))
      : [];

  const invoiceRows = invoicesResult.data ?? [];
  const invoiceTenantIds = [...new Set(invoiceRows.map((r) => r.tenant_id))];
  const { data: invoiceTenants } =
    invoiceTenantIds.length > 0
      ? await supabase.from('tenants').select('id, full_name').in('id', invoiceTenantIds)
      : { data: [] };
  const tenantNameById = new Map((invoiceTenants ?? []).map((t) => [t.id, t.full_name]));
  const invoices: InvoiceRow[] = invoiceRows
    .map((r) => mapInvoiceRow(r as Parameters<typeof mapInvoiceRow>[0]))
    .map((inv) => ({
      id: inv.id,
      tenantName: tenantNameById.get(inv.tenantId) ?? 'Unknown tenant',
      period: inv.period,
      amount: inv.amount,
      status: inv.status,
    }));

  const payments = await loadRecentPayments(supabase, txResult.data ?? []);

  return {
    incomeMtd,
    incomeDelta: pctDelta(incomeMtd, incomeLastMonth),
    expensesMtd,
    expensesDelta: pctDelta(expensesMtd, expensesLastMonth),
    netCashFlow,
    netCashFlowDelta: pctDelta(netCashFlow, netCashFlowLastMonth),
    outstandingRent,
    outstandingDelta: pctDelta(outstandingRent, outstandingLastMonth),
    revenueSeries,
    expenseMix,
    invoices,
    payments,
  };
}

async function loadRecentPayments(
  supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>,
  transactions: {
    id: string;
    amount: number;
    transaction_date: string;
    matched_rent_schedule_id: string | null;
  }[],
): Promise<PaymentRow[]> {
  const scheduleIds = transactions
    .map((t) => t.matched_rent_schedule_id)
    .filter((id): id is string => Boolean(id));
  if (scheduleIds.length === 0) return [];

  const { data: schedules } = await supabase
    .from('rent_schedules')
    .select('id, lease_id')
    .in('id', scheduleIds);
  const leaseIdBySchedule = new Map((schedules ?? []).map((s) => [s.id, s.lease_id]));
  const leaseIds = [...new Set((schedules ?? []).map((s) => s.lease_id))];
  if (leaseIds.length === 0) return [];

  const { data: leaseTenants } = await supabase
    .from('lease_tenants')
    .select('lease_id, tenant_id')
    .in('lease_id', leaseIds);
  const tenantIdByLease = new Map((leaseTenants ?? []).map((lt) => [lt.lease_id, lt.tenant_id]));
  const tenantIds = [...new Set((leaseTenants ?? []).map((lt) => lt.tenant_id))];
  const { data: tenants } =
    tenantIds.length > 0
      ? await supabase.from('tenants').select('id, full_name').in('id', tenantIds)
      : { data: [] };
  const tenantNameById = new Map((tenants ?? []).map((t) => [t.id, t.full_name]));

  return transactions
    .filter((t) => t.matched_rent_schedule_id)
    .map((t) => {
      const leaseId = leaseIdBySchedule.get(t.matched_rent_schedule_id!);
      const tenantId = leaseId ? tenantIdByLease.get(leaseId) : undefined;
      return {
        id: t.id,
        tenantName: (tenantId && tenantNameById.get(tenantId)) || 'Unknown tenant',
        amount: Number(t.amount),
        date: t.transaction_date,
      };
    });
}
