import Link from 'next/link';
import {
  ArrowUpRight,
  Banknote,
  Building2,
  FileSignature,
  Home,
  Plus,
  Receipt,
  ShieldAlert,
  Users,
  Wrench,
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
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
  openMaintenanceCount: number;
  expiringLeasesCount: number;
  revenueSeries: { month: string; billed: number; collected: number; expenses: number }[];
  collectionsMix: { name: string; value: number; tone: string }[];
  activity: ActivityItem[];
  topProperties: TopProperty[];
  mappableProperties: MappableProperty[];
  recentPayments: RecentPayment[];
  insight: string | null;
  displayFirstName?: string;
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
  insight: null,
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default async function DashboardPage() {
  const data = ADMIN_DEMO_MODE ? DEMO_DATA : await loadData();
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
            Add your first property to start tracking your portfolio.
          </p>
          <Link
            href="/properties/new"
            className="mt-2 flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground shadow-glow transition-transform hover:-translate-y-px"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Add your first property
          </Link>
        </div>
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
      label: 'Monthly rental income',
      value: currency(data.monthlyBilled),
      delta: data.monthlyBilledDelta,
      icon: Banknote,
      foot: `Billed for ${monthLabel}`,
    },
    {
      label: 'Outstanding rent',
      value: currency(data.outstandingRent),
      delta: data.outstandingDelta,
      icon: ShieldAlert,
      foot: 'Invoiced, not yet matched',
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
  const quickActions = [
    { label: 'Add property', icon: Building2, href: '/properties/new' },
    { label: 'New lease', icon: FileSignature, href: '/properties' },
    { label: 'Record payment', icon: Receipt, href: '/accounting/bank-transactions/new' },
    { label: 'Log maintenance', icon: Wrench, href: '/properties' },
    { label: 'Invite tenant', icon: Users, href: '/tenants' },
  ];

  return (
    <>
      <PageHeader
        title={`${greeting()}${data.displayFirstName ? `, ${data.displayFirstName}` : ''}`}
        subtitle={`Here's how your portfolio is performing in ${monthLabel}.`}
        actions={
          <>
            <span className="flex h-9 items-center rounded-xl border border-border bg-card px-3.5 text-[13px] font-medium text-muted-foreground">
              {monthLabel}
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
          §2.5) -- populated only once a scheduled evaluation actually runs for this org, which no
          production scheduler triggers automatically yet (TECHNICAL_DEBT_REGISTER.md TD-20).
          Shows the org's real most recent insight when one exists; a truthful "no insights yet"
          state otherwise -- never an invented number. */}
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-5 py-4">
        <Avatar initials="AI" />
        <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
          {data.insight ? (
            <>
              <span className="font-semibold text-foreground">Portfolio insight:</span>{' '}
              {data.insight}
            </>
          ) : (
            'No portfolio insights available yet.'
          )}
        </p>
      </div>
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

async function loadData(): Promise<DashboardData> {
  const supabase = await getServerSupabaseClient();
  const now = new Date();
  const in45Days = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayIso = now.toISOString().slice(0, 10);

  const [
    propertiesResult,
    unitsResult,
    rentSchedulesResult,
    expensesResult,
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
    supabase.from('expenses').select('created_at, amount, status'),
    supabase.from('maintenance_tickets').select('id, status').neq('status', 'completed'),
    supabase
      .from('audit_events')
      .select('id, action, entity_type, created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase.from('leases').select('id, unit_id, rent_amount, status, end_date'),
    supabase
      .from('portfolio_insights')
      .select('message')
      .is('dismissed_at', null)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
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

  const monthlyBilled = billedInMonth(thisMonthKey);
  const monthlyBilledLastMonth = billedInMonth(lastMonthKey);
  const outstandingRent = outstandingAsOf(thisMonthKey);
  const outstandingLastMonth = outstandingAsOf(lastMonthKey);

  const pctDelta = (curr: number, prev: number): number | null => {
    if (prev === 0) return null; // No honest percentage change to compute from a zero base.
    return Math.round(((curr - prev) / prev) * 1000) / 10;
  };

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

  const thisMonthSchedules = rentSchedules.filter((r) => r.due_date.slice(0, 7) === thisMonthKey);
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
    monthlyBilledDelta: pctDelta(monthlyBilled, monthlyBilledLastMonth),
    outstandingRent,
    outstandingDelta: pctDelta(outstandingRent, outstandingLastMonth),
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
    insight: insightResult.data?.message ?? null,
    displayFirstName: profileResult.data?.display_name?.split(' ')[0] || undefined,
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
