import Link from 'next/link';
import { Banknote, Droplets, PiggyBank, Receipt, Scale, Zap } from 'lucide-react';
import { Meter } from '@/components/ui/Meter';
import { Panel } from '@/components/ui/Panel';
import { Pill, type PillTone } from '@/components/ui/Pill';
import type { OwnerFinancialSummary } from '@propvault/types';

// Web owner financial dashboard pass (this date): owner_financial_summary()/
// owner_portfolio_financial_summary() (migrations 166/167) were fully built and wired into API
// routes last pass but never rendered anywhere on the web -- rates & taxes, levies, utilities cost,
// and budget vs actual were only ever visible per-property, inside the Finances tab's raw setting
// forms, never as a portfolio operating picture. This is that missing section: operating costs
// broken out by category, a budget status readout, and the "operating position" figure -- rent
// collected minus owner operating expenses, deliberately never called "profit" (excludes tax,
// finance costs, depreciation, management fee -- same rule the API route's own doc comment states).
// Every number below comes straight from `summary` (server-authoritative RPC output); nothing here
// re-derives a total in the browser.

function currency(amount: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function budgetStatus(percentUsed: number | null): { label: string; tone: PillTone } {
  if (percentUsed === null) return { label: 'Not configured', tone: 'neutral' };
  if (percentUsed >= 100) return { label: 'Over budget', tone: 'destructive' };
  if (percentUsed >= 80) return { label: 'Approaching budget', tone: 'warning' };
  return { label: 'On track', tone: 'success' };
}

export function FinancialOverviewSection({
  summary,
  monthLabel,
  periodLabel,
  manageBudgetHref,
  manageUtilitiesHref,
}: {
  summary: OwnerFinancialSummary | null;
  monthLabel: string;
  /** The dashboard's own selected-period label (e.g. "Year to date 2026"). Shown alongside
   *  monthLabel only when it differs, so a ytd/custom selection never reads as if this
   *  month-granular section matched it exactly -- "one filter context = one financial truth"
   *  means being explicit about scope, not silently mismatched. */
  periodLabel: string;
  manageBudgetHref: string;
  manageUtilitiesHref: string;
}) {
  if (!summary) {
    return (
      <Panel
        title="Financial overview"
        description={`For ${monthLabel} · not available right now`}
      >
        <p className="text-[13px] text-muted-foreground">
          The financial overview could not be loaded. Rent, expenses, and budget figures elsewhere
          on this page are unaffected.
        </p>
      </Panel>
    );
  }

  const status = budgetStatus(summary.budgetUsedPercent);
  const positionPositive = summary.netOperatingPosition >= 0;

  return (
    <Panel
      title="Financial overview"
      description={
        periodLabel === monthLabel
          ? `For ${monthLabel}`
          : `For ${monthLabel} · your selected period (${periodLabel}) spans a range, so this section always shows one month`
      }
      bodyClassName="p-5 space-y-5"
    >
      {/* Operating position -- the headline figure this whole section builds up to. */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface/60 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
            <Scale className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[12px] font-medium text-muted-foreground">Operating position</p>
            <p
              className={`tabular font-display text-2xl font-bold ${positionPositive ? 'text-light-statusPaid dark:text-dark-statusPaid' : 'text-light-statusOverdue dark:text-dark-statusOverdue'}`}
            >
              {currency(summary.netOperatingPosition)}
            </p>
          </div>
        </div>
        <p className="max-w-sm text-[11px] text-muted-foreground sm:text-right">
          Rent collected minus operating expenses (utilities, rates &amp; levies, other) for{' '}
          {monthLabel}. Not accounting profit -- excludes tax, finance costs, depreciation, and
          management fees.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Operating costs breakdown */}
        <div className="rounded-2xl border border-border p-4">
          <p className="mb-3 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
            Operating costs
          </p>
          <div className="grid grid-cols-2 gap-3">
            <CostTile icon={Droplets} label="Utilities" value={summary.utilitiesExpense} />
            <CostTile icon={Zap} label="Rates &amp; levies" value={summary.ratesAndLeviesExpense} />
            <CostTile icon={Receipt} label="Other expenses" value={summary.otherExpenses} />
            <CostTile icon={Banknote} label="Total expenses" value={summary.totalExpenses} emphasize />
          </div>
          <Link
            href={manageUtilitiesHref}
            className="mt-3 inline-block text-[11px] font-medium text-primary hover:underline"
          >
            Manage utilities →
          </Link>
        </div>

        {/* Budget */}
        <div className="rounded-2xl border border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              Budget
            </p>
            <Pill tone={status.tone}>{status.label}</Pill>
          </div>

          {summary.budgetPlanned === null ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-[13px] text-muted-foreground">Budget not configured for {monthLabel}.</p>
              <Link
                href={manageBudgetHref}
                className="rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground"
              >
                Set budget
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <CostTile icon={PiggyBank} label="Monthly budget" value={summary.budgetPlanned} />
                <CostTile icon={Receipt} label="Spent" value={summary.totalExpenses} />
                <CostTile
                  icon={Banknote}
                  label="Remaining"
                  value={summary.budgetRemaining ?? 0}
                  negativeIsBad
                />
                <div>
                  <p className="text-[11px] text-muted-foreground">% used</p>
                  <p className="tabular mt-0.5 text-[15px] font-semibold text-foreground">
                    {summary.budgetUsedPercent ?? 0}%
                  </p>
                </div>
              </div>
              <div className="mt-3">
                <Meter
                  value={summary.budgetUsedPercent ?? 0}
                  tone={
                    (summary.budgetUsedPercent ?? 0) >= 100
                      ? 'destructive'
                      : (summary.budgetUsedPercent ?? 0) >= 80
                        ? 'warning'
                        : 'success'
                  }
                />
              </div>
              <Link
                href={manageBudgetHref}
                className="mt-3 inline-block text-[11px] font-medium text-primary hover:underline"
              >
                Manage budget →
              </Link>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

function CostTile({
  icon: Icon,
  label,
  value,
  emphasize,
  negativeIsBad,
}: {
  icon: typeof Banknote;
  label: string;
  value: number;
  emphasize?: boolean;
  negativeIsBad?: boolean;
}) {
  const isBad = negativeIsBad && value < 0;
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] text-muted-foreground">{label}</p>
        <p
          className={`tabular text-[15px] ${emphasize ? 'font-bold' : 'font-semibold'} ${isBad ? 'text-light-statusOverdue dark:text-dark-statusOverdue' : 'text-foreground'}`}
        >
          {currency(value)}
        </p>
      </div>
    </div>
  );
}
