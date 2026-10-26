import Link from 'next/link';
import { Flower2 } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { loadOrgCemeteryMetrics, loadPayments } from '@/lib/cemetery/data';
import { SALE_STATUS_SWATCH, formatZar } from '@/lib/cemetery/terms';

/**
 * Dashboard section for organisations with Cemetery Management (migration 184), rendered by the dashboard only when
 * getCemeteryContext() allows it. Cemetery figures sit in their own panel and the consolidated view keeps the two
 * income streams on separate lines: grave-site payments are one-off capital receipts, never rental income, and the
 * rental KPIs above are unchanged by them.
 */
export async function CemeteryDashboardSection({
  periodLabel,
  periodStartIso,
  periodEndIso,
  rentCollected,
  outstandingRent,
}: {
  periodLabel: string;
  periodStartIso: string;
  periodEndIso: string;
  rentCollected: number;
  outstandingRent: number;
}) {
  const supabase = await getServerSupabaseClient();
  const [m, payments] = await Promise.all([
    loadOrgCemeteryMetrics(supabase),
    loadPayments(supabase),
  ]);
  if (m.cemeteryCount === 0) return null;
  const cemeteryReceivedInPeriod =
    Math.round(
      payments
        .filter((p) => p.paid_on >= periodStartIso && p.paid_on <= periodEndIso)
        .reduce((s, p) => s + p.amount, 0) * 100,
    ) / 100;
  const tiles = [
    { label: 'Grave sites', value: m.totalSites, swatch: null },
    { label: 'Available', value: m.available, swatch: SALE_STATUS_SWATCH.available },
    { label: 'Reserved', value: m.reserved, swatch: SALE_STATUS_SWATCH.reserved },
    { label: 'Sold', value: m.sold, swatch: SALE_STATUS_SWATCH.sold },
    { label: 'Occupied', value: m.occupied, swatch: null },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Panel
        className="xl:col-span-2"
        title="Cemetery operations"
        description="Grave-site register, sales and balances (all cemeteries)"
        actions={
          <span className="flex gap-3">
            <Link href="/cemetery/reports" className="text-xs font-medium text-primary">
              12-month report →
            </Link>
            <Link href="/cemetery" className="text-xs font-medium text-primary">
              Open register →
            </Link>
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-border p-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {t.swatch ? (
                  <span className={`h-2 w-2 rounded-sm ${t.swatch}`} aria-hidden="true" />
                ) : null}
                {t.label}
              </p>
              <p className="tabular mt-1 font-display text-xl font-bold text-foreground">
                {t.value}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Money label="Grave-site sales value" value={m.salesValue} href="/cemetery/sales" />
          <Money label="Payments received" value={m.paymentsReceived} href="/cemetery/sales" />
          <Money
            label="Outstanding balances"
            value={m.outstanding}
            href="/cemetery/sales?filter=outstanding"
            danger={m.outstanding > 0}
          />
        </div>
      </Panel>

      <Panel title="Income streams" description={`Cash received in ${periodLabel}`}>
        <dl className="space-y-3 text-sm">
          <Line label="Rental income (rent collected)" value={rentCollected} />
          <Line
            label="Grave-site payments (capital receipts)"
            value={cemeteryReceivedInPeriod}
            icon
          />
          <div className="border-t border-border pt-3">
            <Line
              label="Total cash received"
              value={rentCollected + cemeteryReceivedInPeriod}
              strong
            />
          </div>
          <div className="space-y-1 pt-1 text-xs text-muted-foreground">
            <p>Outstanding rent: {formatZar(outstandingRent)}</p>
            <p>Outstanding grave-site balances: {formatZar(m.outstanding)}</p>
          </div>
        </dl>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Reported separately: grave-site sales are not monthly rental income.
        </p>
      </Panel>
    </div>
  );
}

function Money({
  label,
  value,
  href,
  danger,
}: {
  label: string;
  value: number;
  href: string;
  danger?: boolean;
}) {
  return (
    <Link href={href} className="rounded-xl bg-surface p-3 transition hover:shadow-lift">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={`tabular mt-1 text-lg font-bold ${danger ? 'text-destructive' : 'text-foreground'}`}
      >
        {formatZar(value)}
      </p>
    </Link>
  );
}

function Line({
  label,
  value,
  strong,
  icon,
}: {
  label: string;
  value: number;
  strong?: boolean;
  icon?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt
        className={`flex items-center gap-1.5 ${strong ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
      >
        {icon ? <Flower2 className="h-3.5 w-3.5" aria-hidden="true" /> : null}
        {label}
      </dt>
      <dd
        className={`tabular ${strong ? 'text-base font-bold text-foreground' : 'font-medium text-foreground'}`}
      >
        {formatZar(value)}
      </dd>
    </div>
  );
}
