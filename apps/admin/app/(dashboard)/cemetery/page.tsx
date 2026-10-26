import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Landmark, Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { CemeteryLayoutGrid } from '@/components/cemetery/CemeteryLayoutGrid';
import { DemoNotice, StatTile } from '@/components/cemetery/StatTile';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { getCemeteryContext } from '@/lib/cemetery/access';
import { computeCemeteryMetrics, loadCemeteries, loadCemeteryRegister } from '@/lib/cemetery/data';
import { SALE_STATUS_SWATCH, formatDate, formatZar, tenureTerms } from '@/lib/cemetery/terms';

export const dynamic = 'force-dynamic';

type SearchParams = { searchParams: Promise<{ cemeteryId?: string }> };

/**
 * GET /cemetery — Cemetery Management overview (migration 184): grave-site metrics, the interactive schematic layout
 * (click a site for its rights holder, payments and burial status), recent sales and balances. Only for
 * organisations with the module switched on and accountant+ roles; everyone else gets a 404.
 */
export default async function CemeteryOverviewPage({ searchParams }: SearchParams) {
  const ctx = await getCemeteryContext();
  if (!ctx) notFound();
  const { cemeteryId } = await searchParams;
  const supabase = await getServerSupabaseClient();
  const cemeteries = await loadCemeteries(supabase);

  if (cemeteries.length === 0) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Cemetery Management" subtitle="Grave-site register, rights holders, sales, payments and burials." />
        <div className="panel flex flex-col items-center gap-3 px-6 py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary-soft text-primary">
            <Landmark className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="font-display text-xl font-bold text-foreground">No cemetery set up yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">Create a cemetery with its sections; the grave sites are numbered for you (A-001, A-002…).</p>
          {ctx.canManage ? (
            <Link href="/cemetery/new" className="mt-2 inline-flex h-9 items-center rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground">
              Set up a cemetery
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  const cemetery = cemeteries.find((c) => c.id === cemeteryId) ?? cemeteries[0]!;
  const register = await loadCemeteryRegister(supabase, cemetery);
  const terms = tenureTerms(cemetery.tenure_model);
  const metrics = computeCemeteryMetrics(
    register.sites.map((s) => ({ sale_status: s.saleStatus, burial_status: s.burialStatus })),
    register.sales,
    register.payments,
  );
  const purchaserName = new Map(register.purchasers.map((p) => [p.id, p.full_name]));
  const siteRef = new Map(register.sites.map((s) => [s.id, s.reference]));
  const recentSales = register.sales.filter((s) => s.status === 'active').slice(0, 6);
  const owing = register.sales.filter((s) => s.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 6);
  const address = [cemetery.address_line1, cemetery.city, cemetery.province].filter(Boolean).join(', ');

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title={cemetery.name}
        subtitle={`Cemetery Management${address ? ` · ${address}` : ''} · ${cemetery.tenure_model === 'burial_rights' ? 'burial rights (right of interment)' : 'grave plot sales'}`}
        actions={
          ctx.canManage ? (
            <>
              <Link href="/cemetery/new" className="flex h-9 items-center rounded-xl border border-border bg-card px-3.5 text-[13px] font-medium text-foreground">
                New cemetery
              </Link>
              <Link
                href="/cemetery/sales/new"
                className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground shadow-glow"
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> {terms.sellAction}
              </Link>
            </>
          ) : undefined
        }
      />

      {cemetery.is_demo ? <DemoNotice /> : null}

      {cemeteries.length > 1 ? (
        <nav className="flex flex-wrap gap-2" aria-label="Cemeteries">
          {cemeteries.map((c) => (
            <Link
              key={c.id}
              href={`/cemetery?cemeteryId=${c.id}`}
              className={`rounded-pill border px-3 py-1 text-xs font-medium ${c.id === cemetery.id ? 'border-foreground bg-foreground text-card' : 'border-border bg-card text-foreground'}`}
            >
              {c.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Grave sites" value={metrics.totalSites} foot={`${register.sections.length} sections`} />
        <StatTile label="Available" value={metrics.available} swatch={SALE_STATUS_SWATCH.available} foot={`${pct(metrics.available, metrics.totalSites)} of sites`} />
        <StatTile label="Reserved" value={metrics.reserved} swatch={SALE_STATUS_SWATCH.reserved} />
        <StatTile label={terms.sold} value={metrics.sold} swatch={SALE_STATUS_SWATCH.sold} foot={`${metrics.unavailable} unavailable`} />
        <StatTile label="Occupied" value={metrics.occupied} foot={`${metrics.sold - metrics.occupied} sold but unused`} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label={`${terms.sale} value`} value={formatZar(metrics.salesValue)} foot={`${metrics.sold} active ${metrics.sold === 1 ? 'sale' : 'sales'}`} href="/cemetery/sales" />
        <StatTile label="Payments received" value={formatZar(metrics.paymentsReceived)} foot={`${formatZar(metrics.paymentsThisMonth)} this month`} href="/cemetery/sales" />
        <StatTile label="Outstanding balances" value={formatZar(metrics.outstanding)} foot={`${metrics.salesWithBalance} ${terms.holders.toLowerCase()} owing`} href="/cemetery/sales?filter=outstanding" />
      </div>

      <Panel title="Grave-site layout" description="Click a site for its details. Colour = sale status; marker = burial recorded.">
        <CemeteryLayoutGrid
          sections={register.sections.map((s) => ({ id: s.id, code: s.code, name: s.name, sitesPerRow: s.sites_per_row }))}
          sites={register.sites}
          terms={terms}
          canManage={ctx.canManage}
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`Recent ${terms.saleLower === 'sale' ? 'sales' : 'grants of rights'}`} actions={<Link href="/cemetery/sales" className="text-xs font-medium text-primary">All</Link>} bodyClassName="p-0">
          <MiniTable
            empty="No sales recorded yet."
            rows={recentSales.map((s) => ({
              href: `/cemetery/sales/${s.id}`,
              cells: [siteRef.get(s.site_id) ?? '—', purchaserName.get(s.purchaser_id) ?? '—', formatDate(s.sale_date), formatZar(s.price)],
            }))}
          />
        </Panel>
        <Panel title="Outstanding balances" actions={<Link href="/cemetery/sales?filter=outstanding" className="text-xs font-medium text-primary">All</Link>} bodyClassName="p-0">
          <MiniTable
            empty="Nothing outstanding."
            rows={owing.map((s) => ({
              href: `/cemetery/sales/${s.id}`,
              cells: [siteRef.get(s.site_id) ?? '—', purchaserName.get(s.purchaser_id) ?? '—', `paid ${formatZar(s.paid)}`, formatZar(s.balance)],
            }))}
          />
        </Panel>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Grave-site sales are one-off capital receipts. They are reported here and on the dashboard&apos;s cemetery panel, and never counted as
        rental income, rent collected or rent outstanding.
      </p>
    </div>
  );
}

function pct(n: number, d: number) {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : '0%';
}

function MiniTable({ rows, empty }: { rows: { href: string; cells: string[] }[]; empty: string }) {
  if (rows.length === 0) return <p className="px-5 py-6 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.href}>
          <Link href={r.href} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5 text-sm hover:bg-surface sm:grid-cols-[64px_minmax(0,1fr)_110px_100px]">
            <span className="font-semibold text-foreground">{r.cells[0]}</span>
            <span className="truncate text-foreground">{r.cells[1]}</span>
            <span className="hidden text-xs text-muted-foreground sm:block">{r.cells[2]}</span>
            <span className="tabular text-right font-medium text-foreground">{r.cells[3]}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
