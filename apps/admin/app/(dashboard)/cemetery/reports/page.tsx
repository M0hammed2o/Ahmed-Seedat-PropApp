import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { StatTile, DemoNotice } from '@/components/cemetery/StatTile';
import { CemeteryTrendChart } from '@/components/cemetery/CemeteryTrendChart';
import { ReportFilters } from '@/components/cemetery/ReportFilters';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { getCemeteryContext } from '@/lib/cemetery/access';
import {
  cancelledOn,
  loadBurials,
  loadCemeteries,
  loadPayments,
  loadPurchasers,
  loadSales,
  loadSiteEvents,
  loadSites,
  sastDate,
  withBalances,
} from '@/lib/cemetery/data';
import { buildMonthlyReport, monthKeysEndingAt, monthLabel, totals } from '@/lib/cemetery/reports';
import { PAYMENT_METHOD_LABEL, SALE_STATUS_SWATCH, formatDate, formatZar, tenureTerms } from '@/lib/cemetery/terms';

export const dynamic = 'force-dynamic';

type SearchParams = { searchParams: Promise<{ period?: string; month?: string }> };

/**
 * GET /cemetery/reports — cemetery performance over time: monthly sales, cancellations, payments collected
 * (deposits vs instalments), reservations, burials, outstanding balances and site status at each month end, with a
 * drill-down into the individual transactions of any month. Figures are computed from the records themselves
 * (lib/cemetery/reports.ts); grave-site money is reported here, never as rental income.
 */
export default async function CemeteryReportsPage({ searchParams }: SearchParams) {
  const ctx = await getCemeteryContext();
  if (!ctx) notFound();
  const { period: periodParam, month: monthParam } = await searchParams;
  const supabase = await getServerSupabaseClient();
  const today = sastDate();
  const currentMonth = today.slice(0, 7);
  const currentYear = Number(today.slice(0, 4));

  const [cemeteries, sites, sales, purchasers, burials, events] = await Promise.all([
    loadCemeteries(supabase),
    loadSites(supabase),
    loadSales(supabase),
    loadPurchasers(supabase),
    loadBurials(supabase),
    loadSiteEvents(supabase),
  ]);
  const payments = await loadPayments(supabase);
  const terms = tenureTerms(cemeteries[0]?.tenure_model ?? 'burial_rights');

  const periods = [
    { value: '12m', label: 'Last 12 months' },
    { value: String(currentYear), label: `Year ${currentYear}` },
    { value: String(currentYear - 1), label: `Year ${currentYear - 1}` },
  ];
  const period = periods.some((p) => p.value === periodParam) ? periodParam! : '12m';
  const months =
    period === '12m'
      ? monthKeysEndingAt(currentMonth, 12)
      : Array.from({ length: 12 }, (_, i) => `${period}-${String(i + 1).padStart(2, '0')}`).filter((m) => m <= currentMonth);
  const month = months.includes(monthParam ?? '') ? monthParam! : '';

  const reportSales = sales.map((s) => ({
    id: s.id,
    site_id: s.site_id,
    purchaser_id: s.purchaser_id,
    sale_number: s.sale_number,
    sale_date: s.sale_date,
    price: s.price,
    status: s.status,
    cancelled_on: cancelledOn(s),
  }));
  const rows = buildMonthlyReport({
    months,
    siteIds: sites.map((s) => s.id),
    sales: reportSales,
    payments,
    burials,
    events,
    today,
  });
  const sum = totals(rows);
  const last = rows[rows.length - 1];
  const periodLabel = periods.find((p) => p.value === period)!.label;

  const siteRef = new Map(sites.map((s) => [s.id, s.reference]));
  const holder = new Map(purchasers.map((p) => [p.id, p.full_name]));
  const saleById = new Map(withBalances(sales, payments).map((s) => [s.id, s]));
  const inMonth = (d: string | null) => Boolean(month) && Boolean(d) && d!.slice(0, 7) === month;
  const isDemo = cemeteries.some((c) => c.is_demo);

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Cemetery reports"
        subtitle={`${periodLabel} · ${monthLabel(months[0]!, 'long')} – ${monthLabel(months[months.length - 1]!, 'long')}`}
      />
      {isDemo ? <DemoNotice /> : null}
      <ReportFilters
        basePath="/cemetery/reports"
        periods={periods}
        period={period}
        months={months.map((m) => ({ value: m, label: monthLabel(m, 'long') }))}
        month={month}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Sites sold" value={sum.salesCount} foot={`${sum.cancellations} cancelled`} />
        <StatTile label="Sales value" value={formatZar(sum.salesValue)} foot={`gross, ${periodLabel.toLowerCase()}`} />
        <StatTile label="Payments collected" value={formatZar(sum.paymentsCollected)} foot={`${formatZar(sum.depositsCollected)} deposits`} />
        <StatTile label="Outstanding" value={formatZar(last?.outstandingAtMonthEnd ?? 0)} foot={`at ${formatDate(today)}`} />
        <StatTile label="Reservations made" value={sum.reservationsMade} foot={`${sum.reservationsReleased} released`} />
        <StatTile label="Burials" value={sum.burials} />
      </div>

      <Panel title="Sales and collections by month" description="Gross sales value (by sale date) and money received (by payment date)">
        <CemeteryTrendChart data={rows.map((r) => ({ label: r.label, salesValue: r.salesValue, paymentsCollected: r.paymentsCollected }))} />
      </Panel>

      <Panel title="Monthly breakdown" description="Click a month to inspect its transactions" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5">Month</th>
                <th className="px-3 py-2.5 text-right">Sold</th>
                <th className="px-3 py-2.5 text-right">Sales value</th>
                <th className="px-3 py-2.5 text-right">Cancelled</th>
                <th className="px-3 py-2.5 text-right">Deposits</th>
                <th className="px-3 py-2.5 text-right">Instalments</th>
                <th className="px-3 py-2.5 text-right">Collected</th>
                <th className="px-3 py-2.5 text-right">Outstanding (month end)</th>
                <th className="px-3 py-2.5 text-right">Reserved</th>
                <th className="px-3 py-2.5 text-right">Burials</th>
                <th className="px-5 py-2.5">Sites at month end</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.month} className={r.month === month ? 'bg-primary-soft' : 'hover:bg-surface'}>
                  <td className="px-5 py-2">
                    <Link href={`/cemetery/reports?period=${period}&month=${r.month}`} className="font-medium text-primary hover:underline">
                      {r.label}
                    </Link>
                  </td>
                  <td className="tabular px-3 py-2 text-right">{r.salesCount}</td>
                  <td className="tabular px-3 py-2 text-right">{formatZar(r.salesValue)}</td>
                  <td className="tabular px-3 py-2 text-right">{r.cancellations || '—'}</td>
                  <td className="tabular px-3 py-2 text-right">{formatZar(r.depositsCollected)}</td>
                  <td className="tabular px-3 py-2 text-right">{formatZar(r.instalmentsCollected)}</td>
                  <td className="tabular px-3 py-2 text-right font-medium">{formatZar(r.paymentsCollected)}</td>
                  <td className="tabular px-3 py-2 text-right">{formatZar(r.outstandingAtMonthEnd)}</td>
                  <td className="tabular px-3 py-2 text-right">{r.reservationsMade || '—'}</td>
                  <td className="tabular px-3 py-2 text-right">{r.burials || '—'}</td>
                  <td className="px-5 py-2">
                    <span className="flex flex-wrap gap-x-2.5 text-[11px] text-muted-foreground">
                      {(['available', 'reserved', 'sold', 'unavailable'] as const).map((k) => (
                        <span key={k} className="inline-flex items-center gap-1">
                          <span className={`h-2 w-2 rounded-sm ${SALE_STATUS_SWATCH[k]}`} aria-hidden="true" />
                          {r.status[k]}
                        </span>
                      ))}
                      <span>· {r.status.occupied} occupied</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border font-semibold">
              <tr>
                <td className="px-5 py-2.5">Total</td>
                <td className="tabular px-3 py-2.5 text-right">{sum.salesCount}</td>
                <td className="tabular px-3 py-2.5 text-right">{formatZar(sum.salesValue)}</td>
                <td className="tabular px-3 py-2.5 text-right">{sum.cancellations}</td>
                <td className="tabular px-3 py-2.5 text-right">{formatZar(sum.depositsCollected)}</td>
                <td className="tabular px-3 py-2.5 text-right">{formatZar(sum.instalmentsCollected)}</td>
                <td className="tabular px-3 py-2.5 text-right">{formatZar(sum.paymentsCollected)}</td>
                <td className="tabular px-3 py-2.5 text-right">{formatZar(last?.outstandingAtMonthEnd ?? 0)}</td>
                <td className="tabular px-3 py-2.5 text-right">{sum.reservationsMade}</td>
                <td className="tabular px-3 py-2.5 text-right">{sum.burials}</td>
                <td className="px-5 py-2.5" />
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>

      {month ? (
        <div className="space-y-4" id="transactions">
          <h2 className="font-display text-lg font-bold text-foreground">Transactions in {monthLabel(month, 'long')}</h2>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title={`Sales (${sales.filter((s) => inMonth(s.sale_date)).length})`} bodyClassName="p-0">
              <TxTable
                head={['Sale', 'Site', terms.holder, 'Price', 'Status']}
                rows={sales
                  .filter((s) => inMonth(s.sale_date))
                  .map((s) => [
                    <Link key="a" href={`/cemetery/sales/${s.id}`} className="text-primary hover:underline">{s.sale_number}</Link>,
                    siteRef.get(s.site_id) ?? '—',
                    holder.get(s.purchaser_id) ?? '—',
                    formatZar(s.price),
                    s.status === 'cancelled' ? `Cancelled ${formatDate(cancelledOn(s))}` : (saleById.get(s.id)?.balance ?? 0) > 0 ? `Owes ${formatZar(saleById.get(s.id)!.balance)}` : 'Paid',
                  ])}
              />
            </Panel>
            <Panel title={`Payments received (${payments.filter((p) => inMonth(p.paid_on)).length})`} bodyClassName="p-0">
              <TxTable
                head={['Receipt', 'Date', 'Sale', 'Type', 'Amount']}
                rows={payments
                  .filter((p) => inMonth(p.paid_on))
                  .sort((a, b) => a.paid_on.localeCompare(b.paid_on))
                  .map((p) => [
                    <Link key="a" href={`/cemetery/receipts/${p.id}`} className="text-primary hover:underline">{p.receipt_number}</Link>,
                    formatDate(p.paid_on),
                    saleById.get(p.sale_id)?.sale_number ?? '—',
                    `${p.is_deposit ? 'Deposit' : 'Instalment'} · ${PAYMENT_METHOD_LABEL[p.method]}`,
                    formatZar(p.amount, { cents: true }),
                  ])}
              />
            </Panel>
            <Panel title="Reservations, releases and cancellations" bodyClassName="p-0">
              <TxTable
                head={['Date', 'Site', 'Event', terms.holder]}
                rows={events
                  .filter((e) => inMonth(e.event_date) && ['reserved', 'reservation_released', 'sale_cancelled', 'withdrawn', 'returned_to_sale'].includes(e.event_type))
                  .map((e) => [
                    formatDate(e.event_date),
                    <Link key="a" href={`/cemetery/sites/${e.site_id}`} className="text-primary hover:underline">{siteRef.get(e.site_id) ?? '—'}</Link>,
                    e.event_type.replace(/_/g, ' '),
                    e.purchaser_id ? (holder.get(e.purchaser_id) ?? '—') : '—',
                  ])}
              />
            </Panel>
            <Panel title={`Burials (${burials.filter((b) => inMonth(b.burial_date)).length})`} bodyClassName="p-0">
              <TxTable
                head={['Date', 'Site', 'Deceased', 'Undertaker']}
                rows={burials
                  .filter((b) => inMonth(b.burial_date))
                  .map((b) => [
                    formatDate(b.burial_date),
                    <Link key="a" href={`/cemetery/sites/${b.site_id}`} className="text-primary hover:underline">{siteRef.get(b.site_id) ?? '—'}</Link>,
                    b.deceased_full_name,
                    b.funeral_undertaker ?? '—',
                  ])}
              />
            </Panel>
          </div>
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        Sales value is gross (by sale date); cancellations are shown in the month they happened and payments received on
        a cancelled sale stay in &quot;collected&quot;. Outstanding = agreed price minus payments for sales open at the month end.
      </p>
    </div>
  );
}

function TxTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (rows.length === 0) return <p className="px-5 py-5 text-sm text-muted-foreground">None this month.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="px-4 py-2 text-foreground">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
