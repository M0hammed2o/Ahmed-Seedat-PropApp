import Link from 'next/link';
import {
  ArrowUpRight,
  Banknote,
  Building2,
  CircleCheck,
  Clock,
  Droplets,
  FileSignature,
  Home,
  PiggyBank,
  Plus,
  Receipt,
  ShieldAlert,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react';
import { Delta } from '@/components/ui/Delta';
import { Meter } from '@/components/ui/Meter';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { Pill, statusTone } from '@/components/ui/Pill';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { MoneyFlowChart } from '@/components/dashboard/MoneyFlowChart';
import { CollectionsMixChart } from '@/components/dashboard/CollectionsMixChart';
import { PropertyMap, type MappableProperty } from '@/components/dashboard/PropertyMap';
import { RecentActivityFeed, type ActivityItem } from '@/components/dashboard/RecentActivityFeed';
import { PortfolioInsightsPanel } from '@/components/dashboard/PortfolioInsightsPanel';
import { GettingStartedChecklist } from '@/components/dashboard/GettingStartedChecklist';
import {
  DashboardFiltersBar,
  type DashboardPropertyOption,
} from '@/components/dashboard/DashboardFiltersBar';
import { resolvePortalSession } from '@/lib/orgSession';
import { resolveOnboardingProgress, type OnboardingProgress } from '@/lib/onboarding';
import {
  resolvePeriodRange,
  computeDashboardKpis,
  resolveSummaryMonth,
  type DashboardPeriod,
} from '@/lib/dashboardKpis';
import {
  loadPortfolioFinancialOverview,
  loadPropertyFinancialOverview,
} from '@/lib/financialOverview';
import { FinancialOverviewSection } from '@/components/dashboard/FinancialOverviewSection';
import type { OwnerFinancialSummary } from '@propvault/types';

// Owner Dashboard, rebuilt against reference/lovable-ui-reference's routes/index.tsx literal
// structure (2026-08-04 Lovable-adoption batch, UI_INTEGRATION_PLAN.md) -- same KPI set, same
// panel composition, same quick-stat row, same "top performing properties" and "recent payments"
// sections Lovable's own dashboard has. Every figure is computed live from real tables; nothing
// here is fabricated. Panels Lovable shows that this schema cannot honestly back yet (occupancy
// *trend* history, a geocoded portfolio map, a general task system) are preserved at their exact
// size/position with a truthful "not available" state instead of being deleted or faked --
// documented inline at each one, not silently dropped.

interface TopProperty {
  id: string;
  nickname: string;
  status: string;
  monthlyIncome: number;
  occupied: number;
  units: number;
}

interface RecentPayment {
  id: string;
  tenantName: string;
  propertyName: string;
  amount: number;
  date: string;
  status: string;
}

interface DashboardData {
  totalProperties: number;
  totalUnits: number;
  vacantUnits: number;
  occupiedUnits: number;
  occupancyPct: number | null; // Stage 18: null (never 0%) when there are zero rentable units -- "not available", not a fabricated 0%.
  occupancyDelta: number | null;
  portfolioValue: number | null;
  portfolioValuedCount: number;
  totalActiveProperties: number;
  monthlyBilled: number;
  monthlyBilledDelta: number | null;
  outstandingRent: number;
  outstandingDelta: number | null;
  /** Property/period filters pass (V1 launch-completion, this date): plain-language cash-flow
   *  summary, scoped by the same property+period filters as monthlyBilled/outstandingRent above
   *  (computeDashboardKpis, lib/dashboardKpis.ts). rentCollected/expensesTotal/netIncome/
   *  paymentsAwaitingConfirmation are new; monthlyBilled/outstandingRent are the pre-existing
   *  fields, now period-aware instead of hardcoded to "this calendar month." */
  rentCollected: number;
  expensesTotal: number;
  netIncome: number;
  paymentsAwaitingConfirmation: number;
  periodLabel: string;
  /** Web owner financial dashboard pass (this date): server-authoritative operating costs/budget/
   *  operating position, sourced from owner_financial_summary()/owner_portfolio_financial_summary()
   *  (migrations 166/167) via lib/financialOverview.ts. Null only on an RPC error -- rendered as an
   *  honest "not available" state, never a fabricated zero. Always month-granular (resolveSummaryMonth),
   *  independent of the rent KPIs above which stay period-flexible (ytd/custom included). */
  financialOverview: OwnerFinancialSummary | null;
  financialOverviewMonthLabel: string;
  propertyOptions: DashboardPropertyOption[];
  selectedPropertyId: string;
  selectedPeriod: DashboardPeriod;
  openMaintenanceCount: number;
  expiringLeasesCount: number;
  revenueSeries: { month: string; billed: number; collected: number; expenses: number }[];
  collectionsMix: { name: string; value: number; tone: string }[];
  activity: ActivityItem[];
  topProperties: TopProperty[];
  mappableProperties: MappableProperty[];
  recentPayments: RecentPayment[];
  insights: DashboardInsight[];
  displayFirstName?: string;
  orgId?: string;
  orgName?: string;
  /** Role-aware dashboard (item 7, staff security + audit hardening pass, this date): the
   *  Getting-Started/organisation-onboarding content below is Principal-only -- a Manager/Agent/
   *  Accountant/Viewer does not administer the SaaS organisation and should never see "Invite
   *  your team" or the owner-onboarding checklist. */
  role?: 'principal' | 'manager' | 'agent' | 'accountant' | 'viewer';
  onboardingProgress?: OnboardingProgress;
}

interface DashboardInsight {
  id: string;
  message: string;
  severity: 'info' | 'warning' | 'urgent';
  insightType: string;
  generatedAt: string;
  propertyId: string | null;
}

const DEMO_DATA: DashboardData = {
  totalProperties: 4,
  totalUnits: 12,
  vacantUnits: 1,
  occupiedUnits: 11,
  occupancyPct: 92,
  occupancyDelta: 0.4,
  portfolioValue: null,
  portfolioValuedCount: 0,
  totalActiveProperties: 4,
  monthlyBilled: 90700,
  monthlyBilledDelta: 1.8,
  outstandingRent: 6200,
  outstandingDelta: -2.1,
  rentCollected: 84500,
  expensesTotal: 7400,
  netIncome: 77100,
  paymentsAwaitingConfirmation: 2400,
  periodLabel: 'August 2026',
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
    budgetAlerts: [{ propertyId: 'demo-org-1', month: '2026-08-01', level: 'approaching', percentUsed: 82.2 }],
    utilityAnomalyAlerts: [],
  },
  propertyOptions: [{ id: 'demo-property-1', nickname: 'Sea Point Apartment' }],
  selectedPropertyId: '',
  selectedPeriod: 'this_month',
  openMaintenanceCount: 3,
  expiringLeasesCount: 2,
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
  collectionsMix: [
    { name: 'Collected', value: 84, tone: 'var(--chart-1)' },
    { name: 'Pending', value: 9, tone: 'var(--chart-2)' },
    { name: 'Overdue', value: 7, tone: 'var(--chart-4)' },
  ],
  activity: [
    { id: '1', description: 'Invoice issued for Unit 4B', timestamp: new Date().toISOString() },
    { id: '2', description: 'Payment recorded for Unit 2A', timestamp: new Date().toISOString() },
    {
      id: '3',
      description: 'Maintenance ticket completed at Sunset Villas',
      timestamp: new Date().toISOString(),
    },
  ],
  topProperties: [
    {
      id: 'demo-property-1',
      nickname: 'Sea Point Apartment',
      status: 'active',
      monthlyIncome: 12500,
      occupied: 1,
      units: 1,
    },
  ],
  // Real Sea Point, Cape Town coordinates -- renders a real pin if a Mapbox token is configured
  // in this environment, falls back to the honest "not available" state otherwise, same as
  // real (non-demo) mode. Not a fabricated position: this is genuinely where the fixture address is.
  mappableProperties: [
    {
      id: 'demo-property-1',
      nickname: 'Sea Point Apartment',
      latitude: -33.9166,
      longitude: 18.3833,
    },
  ],
  recentPayments: [
    {
      id: 'demo-pmt-1',
      tenantName: 'Naledi Khumalo',
      propertyName: 'Sea Point Apartment',
      amount: 12500,
      date: '2026-08-01',
      status: 'paid',
    },
  ],
  insights: [
    {
      id: 'demo-insight-1',
      message: 'Rent of R12,500 is 5 days overdue (due 2026-08-13).',
      severity: 'warning',
      insightType: 'rent_overdue',
      generatedAt: new Date().toISOString(),
      propertyId: 'demo-property-1',
    },
    {
      id: 'demo-insight-2',
      message: 'Budget for Sea Point Apartment is 82% used with 9 days left in August.',
      severity: 'warning',
      insightType: 'budget_approaching',
      generatedAt: new Date().toISOString(),
      propertyId: 'demo-property-1',
    },
  ],
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

type SearchParams = {
  searchParams: Promise<{ propertyId?: string; period?: string; from?: string; to?: string }>;
};

const KNOWN_PERIODS: readonly DashboardPeriod[] = ['this_month', 'last_month', 'ytd', 'custom'];

export default async function DashboardPage({ searchParams }: SearchParams) {
  const { propertyId, period, from, to } = await searchParams;
  const resolvedPeriod: DashboardPeriod = (KNOWN_PERIODS as readonly string[]).includes(
    period ?? '',
  )
    ? (period as DashboardPeriod)
    : 'this_month';
  const filters = { propertyId: propertyId || undefined, period: resolvedPeriod, from, to };

  const data = ADMIN_DEMO_MODE ? DEMO_DATA : await loadData(filters);
  const monthLabel = new Date().toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
  // Real bug found and fixed 2026-08-04: showing the map when data.mappableProperties has entries
  // but no Mapbox token is configured rendered an empty box with a "Live" badge above it --
  // PropertyMap's own effect correctly no-ops without a token, but the *panel* was only checking
  // "do we have coordinates", not "can we actually render a map with them". Caught by an actual
  // real-browser screenshot, not assumed. Availability now requires both.
  const mapAvailable =
    Boolean(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN) && data.mappableProperties.length > 0;

  // Stage 17: a brand-new organisation has nothing to show in any of the KPI/chart/table panels
  // below -- every one of them would just render its own "no data yet" state side by side, which
  // reads as broken rather than empty. A single welcome/CTA panel replaces that noise; nothing
  // about the populated dashboard below this block changes.
  if (data.totalProperties === 0) {
    // Role-aware dashboard (item 7, staff security + audit hardening pass, this date): a
    // non-principal staff member does not administer the SaaS organisation -- they never see the
    // owner-onboarding checklist ("Invite your team", "Choose your plan", etc.) or a CTA to
    // actions they're not authorized to perform. They get a distinct, honest empty state instead.
    if (data.role && data.role !== 'principal') {
      return (
        <>
          <PageHeader
            title={`${greeting()}${data.displayFirstName ? `, ${data.displayFirstName}` : ''}`}
            subtitle={`Welcome to ${data.orgName ?? 'your organisation'}`}
          />
          <div className="panel flex flex-col items-center gap-3 px-6 py-16 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary-soft text-primary">
              <Building2 className="h-6 w-6" aria-hidden="true" />
            </span>
            <h2 className="font-display text-xl font-bold text-foreground">
              Your workspace is ready
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Here are the properties and tasks you have access to. Your organisation hasn&apos;t
              added any properties yet -- check back once your Principal has set up the portfolio.
            </p>
          </div>
        </>
      );
    }

    // V1 commercial onboarding pass, Phase 5/6: the first-login welcome screen. The hero CTA
    // points at whatever resolveOnboardingProgress() says is genuinely the next step -- staff
    // setup before property setup, per product requirement, achieved by sequencing (the
    // checklist's own step order + this CTA), not a hard database-level block on property
    // creation, which would risk the exact "breaks unrelated fixtures/existing orgs" failure
    // mode already learned the hard way earlier in this build for a different gate.
    const nextStep = data.onboardingProgress?.currentStep;
    const heroHref = nextStep?.href ?? '/properties/new';
    const heroLabel = nextStep
      ? nextStep.id === 'invite_staff'
        ? 'Invite your team'
        : nextStep.label
      : 'Add your first property';
    return (
      <>
        <PageHeader
          title={`${greeting()}${data.displayFirstName ? `, ${data.displayFirstName}` : ''}`}
          subtitle="Let's get your portfolio set up."
        />
        <div className="panel flex flex-col items-center gap-3 px-6 py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary-soft text-primary">
            <Building2 className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="font-display text-xl font-bold text-foreground">Welcome to Proplyst</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Let&apos;s set up your property portfolio -- organisation, team, properties, tenants,
            and leases, one step at a time.
          </p>
          <Link
            href={heroHref}
            className="mt-2 flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground shadow-glow transition-transform hover:-translate-y-px"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> {heroLabel}
          </Link>
        </div>
        {data.orgId && data.onboardingProgress ? (
          <div className="mt-5">
            <GettingStartedChecklist
              orgId={data.orgId}
              progress={data.onboardingProgress}
              defaultExpanded
            />
          </div>
        ) : null}
      </>
    );
  }

  const stats = [
    {
      label: 'Portfolio value',
      value: data.portfolioValue !== null ? currency(data.portfolioValue, true) : 'Not available',
      delta: null, // No valuation history exists yet -- a real delta needs a prior snapshot, not just a prior number.
      icon: Building2,
      foot:
        data.portfolioValuedCount > 0
          ? `${data.portfolioValuedCount} of ${data.totalActiveProperties} ${data.totalActiveProperties === 1 ? 'property' : 'properties'} valued`
          : 'Add property valuations',
    },
    {
      label: 'Expected rent',
      value: currency(data.monthlyBilled),
      delta: data.monthlyBilledDelta,
      icon: Banknote,
      foot: `Billed in ${data.periodLabel}`,
    },
    {
      label: 'Rent collected',
      value: currency(data.rentCollected),
      delta: null, // Delta needs a prior-period comparable figure -- same "only for this_month, no filter" honesty rule as monthlyBilledDelta below.
      icon: CircleCheck,
      foot: `Received in ${data.periodLabel}`,
    },
    {
      label: 'Outstanding rent',
      value: currency(data.outstandingRent),
      delta: data.outstandingDelta,
      icon: ShieldAlert,
      foot: `Unpaid as of ${data.periodLabel}`,
    },
    {
      label: 'Expenses',
      value: currency(data.expensesTotal),
      delta: null,
      icon: Receipt,
      foot: `Recorded in ${data.periodLabel}`,
    },
    {
      label: 'Net income',
      value: currency(data.netIncome),
      delta: null,
      icon: TrendingUp,
      foot: 'Rent collected minus expenses (cash basis)',
    },
    {
      label: 'Payments awaiting confirmation',
      value: currency(data.paymentsAwaitingConfirmation),
      delta: null,
      icon: Clock,
      foot: 'Tenant-reported, not yet staff-confirmed',
    },
    {
      label: 'Occupancy rate',
      value: data.occupancyPct !== null ? `${data.occupancyPct}%` : 'Not available',
      delta: data.occupancyPct !== null ? data.occupancyDelta : null,
      icon: Home,
      foot:
        data.totalUnits > 0
          ? `${data.occupiedUnits} of ${data.totalUnits} units let`
          : 'No units yet',
    },
  ];

  const secondary = [
    { label: 'Properties', value: data.totalProperties, icon: Building2, to: '/properties' },
    { label: 'Units', value: data.totalUnits, icon: Home, to: '/units' },
    {
      label: 'Expiring leases',
      value: data.expiringLeasesCount,
      icon: FileSignature,
      to: '/leases',
    },
    {
      label: 'Open maintenance',
      value: data.openMaintenanceCount,
      icon: Wrench,
      to: '/maintenance',
    },
  ];

  // Lovable's own 6: Add property, New lease, Record payment, Log maintenance, Invite tenant,
  // Schedule task. "Schedule task" has no real destination -- PropertyVault has no standalone
  // task system by explicit prior product decision (DECISIONS.md 2026-07-29: task workflows live
  // inline within Maintenance/Inspections/Leases, not as their own module) -- omitted rather than
  // pointed at a fake page. The other five all have real destinations.
  // Web owner financial dashboard pass (this date): "Record meter reading" needs a specific
  // property, so it points at the selected property's Finances tab when one is filtered, or
  // /properties to pick one otherwise (same fallback the section's own CTAs use). "Review
  // payments" was already reachable only via the "Payments awaiting confirmation" KPI tile with no
  // direct action link -- added here as its own quick action rather than a second, competing entry
  // point. "Manage budget" now points at the dedicated /budget page (web property financial setup
  // pass, §12/§11 -- previously pointed at a single property's Finances tab, forcing the owner to
  // pick a property just to see budget status portfolio-wide).
  const financesHref = data.selectedPropertyId
    ? `/properties/${data.selectedPropertyId}?tab=Finances`
    : '/properties';
  const budgetHref = data.selectedPropertyId ? `/budget?propertyId=${data.selectedPropertyId}` : '/budget';
  const quickActions = [
    { label: 'Add property', icon: Building2, href: '/properties/new' },
    { label: 'New lease', icon: FileSignature, href: '/properties' },
    { label: 'Record payment', icon: Receipt, href: '/accounting/bank-transactions/new' },
    { label: 'Review payments', icon: Clock, href: '/accounting' },
    { label: 'Manage budget', icon: PiggyBank, href: budgetHref },
    { label: 'Record meter reading', icon: Droplets, href: financesHref },
    { label: 'Log maintenance', icon: Wrench, href: '/properties' },
    { label: 'Invite tenant', icon: Users, href: '/tenants' },
  ];

  return (
    <>
      <PageHeader
        title={`${greeting()}${data.displayFirstName ? `, ${data.displayFirstName}` : ''}`}
        subtitle={`Here's how your portfolio is performing in ${data.periodLabel}.`}
        actions={
          <>
            <span className="flex h-9 items-center rounded-xl border border-border bg-card px-3.5 text-[13px] font-medium text-muted-foreground">
              {data.periodLabel}
            </span>
            <Link
              href="/properties/new"
              className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground shadow-glow transition-transform hover:-translate-y-px"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> New property
            </Link>
          </>
        }
      />

      {/* Property/period filters pass (V1 launch-completion, this date): not shown in demo mode --
          DEMO_DATA is a fixed fixture, and a functionally-inert filter bar over unfiltered demo
          numbers would be misleading rather than helpful. */}
      {!ADMIN_DEMO_MODE ? (
        <DashboardFiltersBar
          properties={data.propertyOptions}
          selectedPropertyId={data.selectedPropertyId}
          selectedPeriod={data.selectedPeriod}
        />
      ) : null}

      {data.orgId && data.onboardingProgress && !data.onboardingProgress.allDone ? (
        <GettingStartedChecklist orgId={data.orgId} progress={data.onboardingProgress} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="panel group relative overflow-hidden p-5 transition-shadow hover:shadow-lift"
          >
            <div className="flex items-start justify-between">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary-soft text-primary">
                <s.icon className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              {s.delta !== null ? <Delta value={s.delta} /> : null}
            </div>
            <p className="mt-4 text-[12px] font-medium text-muted-foreground">{s.label}</p>
            <p className="tabular mt-1 font-display text-[26px] leading-tight font-bold text-foreground">
              {s.value}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">{s.foot}</p>
          </div>
        ))}
      </div>

      <FinancialOverviewSection
        summary={data.financialOverview}
        monthLabel={data.financialOverviewMonthLabel}
        periodLabel={data.periodLabel}
        manageBudgetHref={budgetHref}
        manageUtilitiesHref={
          data.selectedPropertyId ? `/properties/${data.selectedPropertyId}?tab=Finances` : '/properties'
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {secondary.map((s) => (
          <Link
            key={s.label}
            href={s.to}
            className="panel flex items-center gap-3 px-4 py-3.5 transition-all hover:-translate-y-px hover:shadow-lift"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface text-muted-foreground">
              <s.icon className="h-[17px] w-[17px]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] text-muted-foreground">{s.label}</span>
              <span className="tabular block text-lg leading-tight font-semibold text-foreground">
                {s.value}
              </span>
            </span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Income vs collections"
          description="Thousands (ZAR) · last 9 months"
          actions={
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[color:var(--chart-1)]" /> Billed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[color:var(--chart-3)]" /> Collected
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[color:var(--chart-4)]" /> Expenses
              </span>
            </div>
          }
          bodyClassName="p-3 pt-5"
        >
          <MoneyFlowChart data={data.revenueSeries} />
        </Panel>

        <div className="space-y-4">
          <Panel
            title="Rent collection"
            description={`Share of ${monthLabel} billing`}
            bodyClassName="p-4"
          >
            {data.monthlyBilled > 0 ? (
              <CollectionsMixChart data={data.collectionsMix} />
            ) : (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                No rent schedules billed this month yet.
              </p>
            )}
          </Panel>

          {/* Lovable's "Occupancy trend" line chart needs a monthly occupancy-history snapshot --
              deliberately never built (this file's own earlier design note, preserved): no
              occupancy snapshot table exists to compute a trend honestly. Panel kept at the same
              position/size with a true point-in-time meter instead of a fabricated series. */}
          <Panel
            title="Occupancy"
            description="Current portfolio-wide (no historical trend data yet)"
            bodyClassName="p-4"
          >
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-muted-foreground">Occupied</span>
              <span className="tabular font-semibold text-foreground">
                {data.totalUnits > 0
                  ? `${data.occupiedUnits} / ${data.totalUnits}`
                  : 'Not available'}
              </span>
            </div>
            <div className="mt-2">
              <Meter value={data.occupancyPct ?? 0} tone="success" />
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Lovable's "Portfolio map" plots properties by hardcoded x/y percentages. Real Mapbox
            map (2026-08-04, Mohammed's explicit choice) when a property has a real geocoded
            coordinate; the property-list fallback below covers properties that don't yet
            (address not geocodable, or MAPBOX_ACCESS_TOKEN not configured in this environment) --
            never a fabricated pin position. */}
        <Panel
          className="xl:col-span-2"
          title="Portfolio"
          description={`${data.totalProperties} ${data.totalProperties === 1 ? 'property' : 'properties'}`}
          actions={
            mapAvailable ? (
              <Pill tone="primary">Live</Pill>
            ) : (
              <Pill tone="neutral">Map view not available</Pill>
            )
          }
          bodyClassName={mapAvailable ? 'p-0' : 'p-5'}
        >
          {mapAvailable ? (
            <PropertyMap properties={data.mappableProperties} />
          ) : data.topProperties.length > 0 ? (
            <ul className="grid gap-3 sm:grid-cols-2">
              {data.topProperties.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/properties/${p.id}`}
                    className="flex items-center gap-3 rounded-xl border border-border px-3.5 py-3 transition-colors hover:bg-surface"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                      <Building2 className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {p.nickname}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {p.occupied}/{p.units} units occupied
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-center text-xs text-muted-foreground">No properties yet.</p>
          )}
          {!mapAvailable && data.topProperties.length > 0 ? (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Properties are geocoded automatically when their address is saved. If this
              doesn&apos;t update, a Mapbox access token may not be configured yet in this
              environment.
            </p>
          ) : null}
        </Panel>

        <Panel
          className="xl:col-span-2"
          title="Recent activity"
          description="Latest actions across your portfolio"
        >
          <RecentActivityFeed items={data.activity} />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Recent payments"
          actions={
            <Link
              href="/accounting/bank-transactions"
              className="text-[12px] font-medium text-primary"
            >
              View ledger
            </Link>
          }
          bodyClassName="p-0"
        >
          {data.recentPayments.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-surface/60 text-[11px] tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Tenant</th>
                    <th className="hidden px-5 py-2.5 font-medium sm:table-cell">Property</th>
                    <th className="hidden px-5 py-2.5 font-medium sm:table-cell">Method</th>
                    <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-5 py-2.5 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.recentPayments.map((p) => (
                    <tr key={p.id} className="transition-colors hover:bg-surface">
                      <td className="px-5 py-3 font-medium text-foreground">{p.tenantName}</td>
                      <td className="hidden px-5 py-3 text-muted-foreground sm:table-cell">
                        {p.propertyName}
                      </td>
                      {/* bank_transactions has no payment-method column -- no real feed distinguishes
                          EFT/card/debit order today, so this is honestly "not tracked", never a
                          guessed value. */}
                      <td className="hidden px-5 py-3 text-muted-foreground sm:table-cell">
                        Not tracked
                      </td>
                      <td className="tabular px-5 py-3 text-right font-semibold text-foreground">
                        {currency(p.amount)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Pill tone={statusTone(p.status)} dot>
                          {p.status}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-8 text-center text-xs text-muted-foreground">
              No matched payments yet.
            </p>
          )}
        </Panel>

        <Panel title="Quick actions" bodyClassName="p-4">
          <div className="grid grid-cols-2 gap-2">
            {quickActions.map((a) => (
              <Link
                key={a.label}
                href={a.href}
                className="flex items-center gap-2 rounded-xl border border-border bg-surface/60 px-3 py-2.5 text-left text-[12px] font-medium text-foreground transition-all hover:-translate-y-px hover:border-primary/30 hover:bg-primary-soft"
              >
                <a.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="truncate">{a.label}</span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>

      <Panel
        title="Top performing properties"
        description="Ranked by monthly income"
        bodyClassName="p-5"
      >
        {data.topProperties.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-3">
            {data.topProperties.slice(0, 3).map((p) => (
              <Link
                key={p.id}
                href={`/properties/${p.id}`}
                className="group rounded-2xl border border-border p-4 transition-all hover:-translate-y-px hover:shadow-lift"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate font-semibold text-foreground">{p.nickname}</p>
                  <Pill tone={statusTone(p.status)}>{p.status}</Pill>
                </div>
                <p className="tabular mt-3 font-display text-xl font-bold text-foreground">
                  {currency(p.monthlyIncome)}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {p.occupied}/{p.units} units occupied
                </p>
                <div className="mt-3">
                  <Meter value={p.units > 0 ? (p.occupied / p.units) * 100 : 0} tone="success" />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-center text-xs text-muted-foreground">No properties yet.</p>
        )}
      </Panel>

      {/* Lovable's "Vault Intelligence" banner shows a fabricated AI insight with an invented
          rand figure. PropertyVault has a real portfolio_insights table (AI_ARCHITECTURE.md
          §2.5), now actually populated by the daily-jobs sweep (final pre-UAT engineering pass,
          Part 4 -- runPortfolioIntelligenceJob). Shows severity, a short reason, when generated,
          navigation to the relevant page, and a real dismiss action -- never an invented number,
          and a truthful "no insights yet" empty state when the feed is genuinely empty. */}
      <PortfolioInsightsPanel insights={data.insights} />
    </>
  );
}

function currency(n: number, compact = false): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: compact ? 1 : 0,
    notation: compact ? 'compact' : 'standard',
  }).format(n);
}

async function loadData(filters: {
  propertyId?: string;
  period: DashboardPeriod;
  from?: string;
  to?: string;
}): Promise<DashboardData> {
  const supabase = await getServerSupabaseClient();
  const now = new Date();
  const in45Days = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayIso = now.toISOString().slice(0, 10);
  const periodRange = resolvePeriodRange(filters.period, { from: filters.from, to: filters.to }, now);

  // V1 commercial onboarding pass: resolved independently of the RLS-scoped queries below (which
  // never needed an explicit org id at all) purely to drive the getting-started checklist -- a
  // second, cheap session lookup, same as (dashboard)/layout.tsx's own independent resolution for
  // its own gates.
  const session = await resolvePortalSession();
  const activeOrg = session?.organizations.find((m) => m.status === 'active');
  const activeOrgId = activeOrg?.orgId;
  const onboardingProgress =
    activeOrgId && activeOrg?.role === 'principal'
      ? await resolveOnboardingProgress(supabase, activeOrgId)
      : undefined;
  // Role-aware dashboard (item 7): org name is only needed for the non-principal empty-state
  // greeting ("Welcome to {org}") -- a cheap, single-row lookup, only fired when actually needed.
  const orgName =
    activeOrgId && activeOrg?.role !== 'principal'
      ? (
          await supabase
            .from('organizations')
            .select('trading_name, legal_name')
            .eq('id', activeOrgId)
            .maybeSingle()
        ).data
      : null;

  const [
    propertiesResult,
    unitsResult,
    rentSchedulesResult,
    expensesResult,
    paymentReportsResult,
    maintenanceResult,
    auditResult,
    leasesResult,
    insightResult,
    profileResult,
  ] = await Promise.all([
    supabase
      .from('properties')
      .select('id, nickname, status, estimated_value, latitude, longitude')
      .eq('status', 'active'),
    supabase.from('units').select('id, property_id, status'),
    supabase.from('rent_schedules').select('lease_id, due_date, amount, status'),
    // expenses carries property_id directly (unlike rent_schedules, which only has lease_id and
    // needs the lease->unit->property join built below) -- the property filter applies here as a
    // real server-side .eq(), not an in-memory filter.
    (() => {
      let q = supabase.from('expenses').select('created_at, amount, status, property_id');
      if (filters.propertyId) q = q.eq('property_id', filters.propertyId);
      return q;
    })(),
    // "Payments awaiting confirmation" -- payment_reports.status = 'reported' is the one real,
    // queryable concept for a tenant-reported-but-not-yet-staff-confirmed payment (same status
    // lib/ownerSummary.ts's own awaitingConfirmation bucket uses, never folded into rentCollected).
    (() => {
      let q = supabase
        .from('payment_reports')
        .select('amount, payment_date, property_id')
        .eq('status', 'reported')
        .gte('payment_date', periodRange.startIso)
        .lte('payment_date', periodRange.endIso);
      if (filters.propertyId) q = q.eq('property_id', filters.propertyId);
      return q;
    })(),
    supabase.from('maintenance_tickets').select('id, status').neq('status', 'completed'),
    supabase
      .from('audit_events')
      .select('id, action, entity_type, created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase.from('leases').select('id, unit_id, rent_amount, status, end_date'),
    // data_source carries a triggering_records[0].property_id for budget_exceeded/
    // budget_approaching/unusual_utility_usage (added this pass, lib/portfolioIntelligence.ts) --
    // portfolio_insights itself has no property_id column (it's an org-wide table), so this is the
    // only way to build a per-property "View X" link for those types.
    supabase
      .from('portfolio_insights')
      .select('id, message, severity, insight_type, generated_at, data_source')
      .is('dismissed_at', null)
      .order('severity', { ascending: false })
      .order('generated_at', { ascending: false })
      .limit(8),
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { data: null };
      return supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
    })(),
  ]);
  if (propertiesResult.error)
    throw new Error(`Failed to load properties: ${propertiesResult.error.message}`);
  if (unitsResult.error) throw new Error(`Failed to load units: ${unitsResult.error.message}`);
  if (rentSchedulesResult.error)
    throw new Error(`Failed to load rent schedule: ${rentSchedulesResult.error.message}`);
  if (expensesResult.error)
    throw new Error(`Failed to load expenses: ${expensesResult.error.message}`);
  if (paymentReportsResult.error)
    throw new Error(`Failed to load payment reports: ${paymentReportsResult.error.message}`);
  if (maintenanceResult.error)
    throw new Error(`Failed to load maintenance: ${maintenanceResult.error.message}`);
  if (leasesResult.error) throw new Error(`Failed to load leases: ${leasesResult.error.message}`);

  const properties = propertiesResult.data ?? [];
  const units = unitsResult.data ?? [];
  const occupiedUnits = units.filter((u) => u.status === 'occupied').length;
  const vacantUnits = units.filter((u) => u.status === 'vacant').length;
  const occupancyPct = units.length > 0 ? Math.round((occupiedUnits / units.length) * 100) : null;

  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const thisMonthKey = monthKey(now);
  const lastMonthKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const rentSchedules = rentSchedulesResult.data ?? [];
  const expenses = expensesResult.data ?? [];
  const leases = leasesResult.data ?? [];
  const activeLeases = leases.filter((l) => l.status === 'active');
  const unitPropertyById = new Map(units.map((u) => [u.id, u.property_id]));
  const leaseByUnit = new Map(activeLeases.map((l) => [l.unit_id, l]));

  // rent_schedules has no property_id column (only lease_id) -- the property filter is applied
  // here in-memory via the same lease->unit->property join loadRecentPayments() already does
  // below, rather than as a server-side .eq(). Every downstream figure (KPI tiles, the 9-month
  // trend chart, the collections-mix donut) is derived from scopedRentSchedules, never the raw
  // rentSchedules array, once a property is selected.
  const leasePropertyById = new Map(leases.map((l) => [l.id, unitPropertyById.get(l.unit_id)]));
  const scopedRentSchedules = filters.propertyId
    ? rentSchedules.filter((r) => leasePropertyById.get(r.lease_id) === filters.propertyId)
    : rentSchedules;

  const billedInMonth = (key: string) =>
    scopedRentSchedules
      .filter((r) => r.due_date.slice(0, 7) === key)
      .reduce((sum, r) => sum + Number(r.amount), 0);
  const collectedInMonth = (key: string) =>
    scopedRentSchedules
      .filter((r) => r.status === 'paid' && r.due_date.slice(0, 7) === key)
      .reduce((sum, r) => sum + Number(r.amount), 0);
  const outstandingAsOf = (key: string) =>
    scopedRentSchedules
      .filter(
        (r) =>
          (r.status === 'invoiced' || r.status === 'overdue' || r.status === 'partial') &&
          r.due_date.slice(0, 7) <= key,
      )
      .reduce((sum, r) => sum + Number(r.amount), 0);

  const pctDelta = (curr: number, prev: number): number | null => {
    if (prev === 0) return null; // No honest percentage change to compute from a zero base.
    return Math.round(((curr - prev) / prev) * 1000) / 10;
  };

  // Property/period filters pass (V1 launch-completion, this date): monthlyBilled/outstandingRent
  // are now scoped to the selected period (periodRange) and property (scopedRentSchedules)
  // instead of being hardcoded to "this calendar month, whole org." Deltas are only computed in
  // the exact default view (period=this_month, no property filter) -- the one case with a
  // well-defined "vs last month" comparable; any other period or property selection shows no
  // arrow rather than a misleading one (same honesty rule pctDelta's own zero-base case follows).
  const showDelta = filters.period === 'this_month' && !filters.propertyId;
  const rentSchedulesInPeriod = scopedRentSchedules.filter(
    (r) => r.due_date >= periodRange.startIso && r.due_date <= periodRange.endIso,
  );
  const rentSchedulesAsOfPeriodEnd = scopedRentSchedules.filter(
    (r) => r.due_date <= periodRange.endIso,
  );
  const expensesInPeriod = expenses.filter(
    (e) =>
      e.created_at.slice(0, 10) >= periodRange.startIso &&
      e.created_at.slice(0, 10) <= periodRange.endIso,
  );
  const paymentsAwaitingConfirmationTotal = (paymentReportsResult.data ?? []).reduce(
    (sum, r) => sum + Number(r.amount),
    0,
  );

  const kpis = computeDashboardKpis({
    rentSchedulesInPeriod: rentSchedulesInPeriod.map((r) => ({
      dueDate: r.due_date,
      amount: r.amount,
      status: r.status,
    })),
    rentSchedulesAsOfPeriodEnd: rentSchedulesAsOfPeriodEnd.map((r) => ({
      dueDate: r.due_date,
      amount: r.amount,
      status: r.status,
    })),
    expensesInPeriod: expensesInPeriod.map((e) => ({ amount: e.amount, status: e.status })),
    paymentsAwaitingConfirmation: paymentsAwaitingConfirmationTotal,
  });

  const monthlyBilled = kpis.expectedRent;
  const outstandingRent = kpis.outstandingRent;
  const monthlyBilledLastMonth = showDelta ? billedInMonth(lastMonthKey) : null;
  const outstandingLastMonth = showDelta ? outstandingAsOf(lastMonthKey) : null;

  const revenueSeries = Array.from({ length: 9 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (8 - i), 1);
    const key = monthKey(d);
    const monthExpenses = expenses
      .filter(
        (e) =>
          (e.status === 'recorded' || e.status === 'reimbursed') &&
          e.created_at.slice(0, 7) === key,
      )
      .reduce((sum, e) => sum + Number(e.amount), 0);
    return {
      month: d.toLocaleDateString('en-ZA', { month: 'short' }),
      billed: billedInMonth(key),
      collected: collectedInMonth(key),
      expenses: monthExpenses,
    };
  });

  const thisMonthSchedules = scopedRentSchedules.filter(
    (r) => r.due_date.slice(0, 7) === thisMonthKey,
  );
  const thisMonthBilledTotal = thisMonthSchedules.reduce((sum, r) => sum + Number(r.amount), 0);
  const collectionsMix =
    thisMonthBilledTotal > 0
      ? (
          [
            { name: 'Collected', status: ['paid'], tone: 'var(--chart-1)' },
            { name: 'Pending', status: ['invoiced', 'partial'], tone: 'var(--chart-2)' },
            { name: 'Overdue', status: ['overdue'], tone: 'var(--chart-4)' },
          ] as const
        ).map((bucket) => ({
          name: bucket.name,
          tone: bucket.tone,
          value: Math.round(
            (thisMonthSchedules
              .filter((r) => (bucket.status as readonly string[]).includes(r.status))
              .reduce((sum, r) => sum + Number(r.amount), 0) /
              thisMonthBilledTotal) *
              100,
          ),
        }))
      : [];

  const activity: ActivityItem[] = (auditResult.data ?? []).map((row) => ({
    id: row.id,
    description: describeAuditAction(row.action, row.entity_type),
    timestamp: row.created_at,
  }));

  const valuedProperties = properties.filter((p) => p.estimated_value !== null);
  const portfolioValue =
    valuedProperties.length > 0
      ? valuedProperties.reduce((sum, p) => sum + Number(p.estimated_value), 0)
      : null;

  const propertyIncome = new Map<string, number>();
  const propertyOccupied = new Map<string, number>();
  const propertyUnitCount = new Map<string, number>();
  for (const u of units) {
    propertyUnitCount.set(u.property_id, (propertyUnitCount.get(u.property_id) ?? 0) + 1);
    if (u.status === 'occupied')
      propertyOccupied.set(u.property_id, (propertyOccupied.get(u.property_id) ?? 0) + 1);
    const rent = Number(leaseByUnit.get(u.id)?.rent_amount ?? 0);
    if (rent > 0)
      propertyIncome.set(u.property_id, (propertyIncome.get(u.property_id) ?? 0) + rent);
  }
  const topProperties: TopProperty[] = properties
    .map((p) => ({
      id: p.id,
      nickname: p.nickname,
      status: p.status,
      monthlyIncome: propertyIncome.get(p.id) ?? 0,
      occupied: propertyOccupied.get(p.id) ?? 0,
      units: propertyUnitCount.get(p.id) ?? 0,
    }))
    .sort((a, b) => b.monthlyIncome - a.monthlyIncome);

  const mappableProperties: MappableProperty[] = properties
    .filter(
      (p): p is typeof p & { latitude: number; longitude: number } =>
        p.latitude !== null && p.longitude !== null,
    )
    .map((p) => ({
      id: p.id,
      nickname: p.nickname,
      latitude: Number(p.latitude),
      longitude: Number(p.longitude),
    }));

  const recentPayments = await loadRecentPayments(supabase, unitPropertyById, properties);

  const { month: summaryMonth, monthLabel: financialOverviewMonthLabel } =
    resolveSummaryMonth(periodRange);
  const financialOverview = filters.propertyId
    ? await loadPropertyFinancialOverview(supabase, filters.propertyId, summaryMonth)
    : activeOrgId
      ? await loadPortfolioFinancialOverview(supabase, activeOrgId, summaryMonth)
      : null;

  return {
    totalProperties: properties.length,
    totalActiveProperties: properties.length,
    totalUnits: units.length,
    vacantUnits,
    occupiedUnits,
    occupancyPct,
    occupancyDelta: null, // No historical occupancy snapshot exists to compute a real delta from.
    portfolioValue,
    portfolioValuedCount: valuedProperties.length,
    monthlyBilled,
    monthlyBilledDelta:
      monthlyBilledLastMonth !== null ? pctDelta(monthlyBilled, monthlyBilledLastMonth) : null,
    outstandingRent,
    outstandingDelta:
      outstandingLastMonth !== null ? pctDelta(outstandingRent, outstandingLastMonth) : null,
    rentCollected: kpis.rentCollected,
    expensesTotal: kpis.expensesTotal,
    netIncome: kpis.netIncome,
    paymentsAwaitingConfirmation: kpis.paymentsAwaitingConfirmation,
    periodLabel: periodRange.label,
    financialOverview,
    financialOverviewMonthLabel,
    propertyOptions: properties.map((p) => ({ id: p.id, nickname: p.nickname })),
    selectedPropertyId: filters.propertyId ?? '',
    selectedPeriod: filters.period,
    openMaintenanceCount: maintenanceResult.data?.length ?? 0,
    expiringLeasesCount: leases.filter(
      (l) =>
        l.status === 'active' &&
        l.end_date !== null &&
        l.end_date >= todayIso &&
        l.end_date <= in45Days,
    ).length,
    revenueSeries,
    collectionsMix,
    activity,
    topProperties,
    mappableProperties,
    recentPayments,
    insights: (insightResult.data ?? []).map((row) => {
      const dataSource = row.data_source as
        | { triggering_records?: { property_id?: string }[] }
        | null;
      return {
        id: row.id as string,
        message: row.message as string,
        severity: row.severity as DashboardInsight['severity'],
        insightType: row.insight_type as string,
        generatedAt: row.generated_at as string,
        propertyId: dataSource?.triggering_records?.[0]?.property_id ?? null,
      };
    }),
    displayFirstName: profileResult.data?.display_name?.split(' ')[0] || undefined,
    orgId: activeOrgId,
    orgName: orgName?.trading_name || orgName?.legal_name || undefined,
    role: activeOrg?.role,
    onboardingProgress,
  };
}

async function loadRecentPayments(
  supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>,
  unitPropertyById: Map<string, string>,
  properties: { id: string; nickname: string }[],
): Promise<RecentPayment[]> {
  const { data: transactions, error } = await supabase
    .from('bank_transactions')
    .select('id, amount, transaction_date, match_status, matched_rent_schedule_id')
    .eq('match_status', 'matched')
    .order('transaction_date', { ascending: false })
    .limit(6);
  if (error || !transactions || transactions.length === 0) return [];

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

  const [{ data: leases }, { data: leaseTenants }] = await Promise.all([
    supabase.from('leases').select('id, unit_id').in('id', leaseIds),
    supabase.from('lease_tenants').select('lease_id, tenant_id').in('lease_id', leaseIds),
  ]);
  const unitByLease = new Map((leases ?? []).map((l) => [l.id, l.unit_id]));
  const tenantIdByLease = new Map((leaseTenants ?? []).map((lt) => [lt.lease_id, lt.tenant_id]));
  const tenantIds = [...new Set((leaseTenants ?? []).map((lt) => lt.tenant_id))];
  const { data: tenants } =
    tenantIds.length > 0
      ? await supabase.from('tenants').select('id, full_name').in('id', tenantIds)
      : { data: [] };
  const tenantNameById = new Map((tenants ?? []).map((t) => [t.id, t.full_name]));
  const propertyNameById = new Map(properties.map((p) => [p.id, p.nickname]));

  return transactions
    .filter((t) => t.matched_rent_schedule_id)
    .map((t) => {
      const leaseId = leaseIdBySchedule.get(t.matched_rent_schedule_id!);
      const unitId = leaseId ? unitByLease.get(leaseId) : undefined;
      const propertyId = unitId ? unitPropertyById.get(unitId) : undefined;
      const tenantId = leaseId ? tenantIdByLease.get(leaseId) : undefined;
      return {
        id: t.id,
        tenantName: (tenantId && tenantNameById.get(tenantId)) || 'Unknown tenant',
        propertyName: (propertyId && propertyNameById.get(propertyId)) || 'Unknown property',
        amount: Number(t.amount),
        date: t.transaction_date,
        status: 'paid',
      };
    });
}

const ACTION_LABELS: Record<string, string> = {
  email_sent: 'Notification email sent',
  whatsapp_sent: 'WhatsApp notification sent',
  'rent_schedules.generate': 'Rent schedules generated',
  'billing.checkout_started': 'Subscription checkout started',
  'billing.subscription_cancelled': 'Subscription cancelled',
  'billing.payment_refunded': 'Payment refunded',
};

function describeAuditAction(action: string, entityType: string): string {
  const label = ACTION_LABELS[action];
  if (label) return label;
  return `${action.replace(/[._]/g, ' ')} — ${entityType.replace(/_/g, ' ')}`;
}
