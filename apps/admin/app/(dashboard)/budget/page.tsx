import Link from 'next/link';
import type { BudgetVsActual } from '@propvault/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { Meter } from '@/components/ui/Meter';
import { EmptyState } from '@/components/ui/EmptyState';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { resolvePortalSession } from '@/lib/orgSession';
import { BudgetFiltersBar } from '@/components/budget/BudgetFiltersBar';
import { lastTwelveMonthOptions } from '@/lib/budgetMonths';

/**
 * GET /budget -- web property financial setup pass (WORKLOG.md this date), §11. A first-class,
 * dedicated budget-management destination -- previously the only place to see budget vs actual
 * was per-property, inside that property's own Finances tab, with no portfolio-wide view and no
 * nav entry at all. Uses the EXISTING budget_vs_actual() RPC (migration 20260101000164) once per
 * active property for the selected month -- the same authoritative source
 * PropertyFinancesPanel/FinancialOverviewSection already read, never a new budgeting backend.
 * "Manage" on each row deep-links to that property's own Finances tab (#property-budget), which
 * remains the one place a budget is actually edited -- this page is a portfolio-wide view over
 * that same data, not a second editing surface.
 */

function currency(amount: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function statusFor(planned: number | null, percentUsed: number | null): { label: string; tone: PillTone } {
  if (planned === null) return { label: 'Not configured', tone: 'neutral' };
  if (percentUsed === null) return { label: 'On track', tone: 'success' };
  if (percentUsed >= 100) return { label: 'Over budget', tone: 'destructive' };
  if (percentUsed >= 80) return { label: 'Approaching budget', tone: 'warning' };
  return { label: 'On track', tone: 'success' };
}

interface BudgetRow {
  propertyId: string;
  propertyNickname: string;
  budgetVsActual: BudgetVsActual | null;
}

type SearchParams = { searchParams: Promise<{ propertyId?: string; month?: string }> };

// Demo mode has exactly one real, navigable property everywhere else in this app
// (properties/page.tsx's own DEMO_PROPERTIES/DEMO_CARDS, properties/[id]/page.tsx's demo branch)
// -- matched here rather than inventing extra fictional properties whose "Edit budget" link would
// 404, a dead link the visual-acceptance pass explicitly checks for.
const DEMO_ROWS: BudgetRow[] = [
  {
    propertyId: 'demo-property-1',
    propertyNickname: 'Sea Point Apartment',
    budgetVsActual: {
      budgetId: 'demo-budget-1',
      plannedAmount: 5000,
      actualAmount: 4200,
      remainingAmount: 800,
      varianceAmount: -800,
      percentUsed: 84,
    },
  },
];

export default async function BudgetPage({ searchParams }: SearchParams) {
  const { propertyId, month: monthParam } = await searchParams;
  const monthOptions = lastTwelveMonthOptions();
  const month = monthOptions.some((o) => o.value === monthParam) ? monthParam! : monthOptions[0]!.value;
  const monthLabel = monthOptions.find((o) => o.value === month)?.label ?? month;

  const { rows, propertyOptions } = ADMIN_DEMO_MODE
    ? {
        rows: propertyId ? DEMO_ROWS.filter((r) => r.propertyId === propertyId) : DEMO_ROWS,
        propertyOptions: DEMO_ROWS.map((r) => ({ id: r.propertyId, nickname: r.propertyNickname })),
      }
    : await loadData(propertyId, month);

  const configuredCount = rows.filter((r) => r.budgetVsActual?.plannedAmount != null).length;
  const overBudgetCount = rows.filter((r) => (r.budgetVsActual?.percentUsed ?? 0) >= 100).length;
  const totalPlanned = rows.reduce((sum, r) => sum + (r.budgetVsActual?.plannedAmount ?? 0), 0);
  const totalActual = rows.reduce((sum, r) => sum + (r.budgetVsActual?.actualAmount ?? 0), 0);

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title="Budget" subtitle={`Portfolio-wide budget vs actual for ${monthLabel}.`} />

      {!ADMIN_DEMO_MODE ? (
        <BudgetFiltersBar
          properties={propertyOptions}
          selectedPropertyId={propertyId ?? ''}
          selectedMonth={month}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="panel px-5 py-4">
          <p className="text-[11px] text-muted-foreground">Properties with a budget set</p>
          <p className="tabular mt-1.5 font-display text-[22px] font-bold text-foreground">
            {configuredCount} / {rows.length}
          </p>
        </div>
        <div className="panel px-5 py-4">
          <p className="text-[11px] text-muted-foreground">Total planned</p>
          <p className="tabular mt-1.5 font-display text-[22px] font-bold text-foreground">
            {currency(totalPlanned)}
          </p>
        </div>
        <div className="panel px-5 py-4">
          <p className="text-[11px] text-muted-foreground">Total actual</p>
          <p className="tabular mt-1.5 font-display text-[22px] font-bold text-foreground">
            {currency(totalActual)}
          </p>
        </div>
        <div className="panel px-5 py-4">
          <p className="text-[11px] text-muted-foreground">Over budget</p>
          <p
            className={`tabular mt-1.5 font-display text-[22px] font-bold ${overBudgetCount > 0 ? 'text-light-statusOverdue dark:text-dark-statusOverdue' : 'text-foreground'}`}
          >
            {overBudgetCount}
          </p>
        </div>
      </div>

      <Panel title="Properties" bodyClassName="p-0">
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<span className="text-lg">🏠</span>} title="No properties yet" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Property</th>
                  <th className="px-5 py-3 font-medium">Budget</th>
                  <th className="px-5 py-3 font-medium">Actual</th>
                  <th className="px-5 py-3 font-medium">Remaining</th>
                  <th className="px-5 py-3 font-medium">% used</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const bva = row.budgetVsActual;
                  const planned = bva?.plannedAmount ?? null;
                  const status = statusFor(planned, bva?.percentUsed ?? null);
                  return (
                    <tr key={row.propertyId} className="border-b border-border last:border-0">
                      <td className="px-5 py-3 font-medium text-foreground">
                        <Link href={`/properties/${row.propertyId}?tab=Finances`} className="hover:underline">
                          {row.propertyNickname}
                        </Link>
                      </td>
                      <td className="tabular px-5 py-3 text-foreground">
                        {planned !== null ? currency(planned) : '—'}
                      </td>
                      <td className="tabular px-5 py-3 text-foreground">
                        {bva ? currency(bva.actualAmount) : '—'}
                      </td>
                      <td className="tabular px-5 py-3 text-foreground">
                        {bva?.remainingAmount != null ? currency(bva.remainingAmount) : '—'}
                      </td>
                      <td className="px-5 py-3">
                        {bva?.percentUsed != null ? (
                          <div className="flex items-center gap-2">
                            <span className="tabular w-12 shrink-0 text-foreground">{bva.percentUsed}%</span>
                            <div className="w-20">
                              <Meter
                                value={bva.percentUsed}
                                tone={bva.percentUsed >= 100 ? 'destructive' : bva.percentUsed >= 80 ? 'warning' : 'success'}
                              />
                            </div>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <Pill tone={status.tone}>{status.label}</Pill>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Link
                          href={
                            planned !== null
                              ? `/properties/${row.propertyId}?tab=Finances#property-budget`
                              : `/properties/${row.propertyId}?tab=Finances`
                          }
                          className="text-[12px] font-medium text-primary hover:underline"
                        >
                          {planned !== null ? 'Edit budget' : 'Set budget'}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

async function loadData(
  propertyId: string | undefined,
  month: string,
): Promise<{ rows: BudgetRow[]; propertyOptions: { id: string; nickname: string }[] }> {
  const supabase = await getServerSupabaseClient();
  const session = await resolvePortalSession();
  const activeOrgId = session?.organizations.find((m) => m.status === 'active')?.orgId;
  if (!activeOrgId) return { rows: [], propertyOptions: [] };

  let query = supabase
    .from('properties')
    .select('id, nickname')
    .eq('org_id', activeOrgId)
    .eq('status', 'active')
    .order('nickname', { ascending: true });
  if (propertyId) query = query.eq('id', propertyId);
  const { data: properties, error } = await query;
  if (error || !properties) return { rows: [], propertyOptions: [] };

  const { data: allProperties } = await supabase
    .from('properties')
    .select('id, nickname')
    .eq('org_id', activeOrgId)
    .eq('status', 'active')
    .order('nickname', { ascending: true });

  const rows = await Promise.all(
    properties.map(async (p): Promise<BudgetRow> => {
      const { data, error: rpcError } = await supabase
        .rpc('budget_vs_actual', { p_property_id: p.id, p_month: month })
        .maybeSingle();
      if (rpcError || !data) {
        return { propertyId: p.id, propertyNickname: p.nickname, budgetVsActual: null };
      }
      const row = data as {
        budget_id: string | null;
        planned_amount: string | null;
        actual_amount: string;
        remaining_amount: string | null;
        variance_amount: string | null;
        percent_used: string | null;
      };
      return {
        propertyId: p.id,
        propertyNickname: p.nickname,
        budgetVsActual: {
          budgetId: row.budget_id,
          plannedAmount: row.planned_amount === null ? null : Number(row.planned_amount),
          actualAmount: Number(row.actual_amount),
          remainingAmount: row.remaining_amount === null ? null : Number(row.remaining_amount),
          varianceAmount: row.variance_amount === null ? null : Number(row.variance_amount),
          percentUsed: row.percent_used === null ? null : Number(row.percent_used),
        },
      };
    }),
  );

  return {
    rows,
    propertyOptions: (allProperties ?? []).map((p) => ({ id: p.id, nickname: p.nickname })),
  };
}
