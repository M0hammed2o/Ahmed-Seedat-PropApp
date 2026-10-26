import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { StatTile } from '@/components/cemetery/StatTile';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { getCemeteryContext } from '@/lib/cemetery/access';
import { loadCemeteries, loadPayments, loadPurchasers, loadSales, loadSites, withBalances } from '@/lib/cemetery/data';
import { formatDate, formatZar, tenureTerms } from '@/lib/cemetery/terms';

export const dynamic = 'force-dynamic';

type SearchParams = { searchParams: Promise<{ filter?: string }> };

/** GET /cemetery/sales — the sales / grants register with paid and outstanding amounts per sale. */
export default async function CemeterySalesPage({ searchParams }: SearchParams) {
  const ctx = await getCemeteryContext();
  if (!ctx) notFound();
  const { filter } = await searchParams;
  const supabase = await getServerSupabaseClient();
  const [cemeteries, sales, purchasers, sites] = await Promise.all([
    loadCemeteries(supabase),
    loadSales(supabase),
    loadPurchasers(supabase),
    loadSites(supabase),
  ]);
  const payments = await loadPayments(supabase);
  const all = withBalances(sales, payments).filter((s) => s.status === 'active');
  const rows = filter === 'outstanding' ? all.filter((s) => s.balance > 0) : filter === 'paid' ? all.filter((s) => s.balance <= 0) : all;
  const terms = tenureTerms(cemeteries[0]?.tenure_model ?? 'burial_rights');
  const siteRef = new Map(sites.map((s) => [s.id, s.reference]));
  const holder = new Map(purchasers.map((p) => [p.id, p.full_name]));
  const cemeteryName = new Map(cemeteries.map((c) => [c.id, c.name]));
  const total = (k: 'price' | 'paid' | 'balance') => all.reduce((sum, s) => sum + s[k], 0);

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title={terms.saleLower === 'sale' ? 'Grave-site sales' : 'Grants of burial rights'}
        subtitle="Every sale with what has been paid and what is still owed."
        actions={
          ctx.canManage ? (
            <Link href="/cemetery/sales/new" className="flex h-9 items-center rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground">
              {terms.sellAction}
            </Link>
          ) : undefined
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Sales value" value={formatZar(total('price'))} foot={`${all.length} active`} />
        <StatTile label="Payments received" value={formatZar(total('paid'))} />
        <StatTile label="Outstanding" value={formatZar(total('balance'))} foot={`${all.filter((s) => s.balance > 0).length} with a balance`} />
      </div>
      <nav className="flex gap-2" aria-label="Filter sales">
        {[
          ['all', 'All'],
          ['outstanding', 'Outstanding'],
          ['paid', 'Fully paid'],
        ].map(([key, label]) => {
          const active = (filter ?? 'all') === key;
          return (
            <Link
              key={key}
              href={key === 'all' ? '/cemetery/sales' : `/cemetery/sales?filter=${key}`}
              className={`rounded-pill border px-3 py-1 text-xs font-medium ${active ? 'border-foreground bg-foreground text-card' : 'border-border bg-card text-foreground'}`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      <Panel bodyClassName="p-0">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No sales match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5">Sale no.</th>
                  <th className="px-3 py-2.5">Site</th>
                  <th className="px-3 py-2.5">{terms.holder}</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5 text-right">Price</th>
                  <th className="px-3 py-2.5 text-right">Paid</th>
                  <th className="px-5 py-2.5 text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((s) => (
                  <tr key={s.id} className="hover:bg-surface">
                    <td className="px-5 py-2.5">
                      <Link href={`/cemetery/sales/${s.id}`} className="font-medium text-primary hover:underline">
                        {s.sale_number}
                      </Link>
                      {s.is_demo ? <span className="ml-2 text-[10px] uppercase text-muted-foreground">demo</span> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={`/cemetery/sites/${s.site_id}`} className="text-foreground hover:underline">
                        {siteRef.get(s.site_id) ?? '—'}
                      </Link>
                      {cemeteries.length > 1 ? <span className="block text-[11px] text-muted-foreground">{cemeteryName.get(s.cemetery_id)}</span> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={`/cemetery/purchasers/${s.purchaser_id}`} className="text-foreground hover:underline">
                        {holder.get(s.purchaser_id) ?? '—'}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{formatDate(s.sale_date)}</td>
                    <td className="tabular px-3 py-2.5 text-right">{formatZar(s.price)}</td>
                    <td className="tabular px-3 py-2.5 text-right">{formatZar(s.paid)}</td>
                    <td className={`tabular px-5 py-2.5 text-right font-semibold ${s.balance > 0 ? 'text-destructive' : 'text-success'}`}>
                      {s.balance > 0 ? formatZar(s.balance) : 'Paid'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
