import Link from 'next/link';
import { Building2, DoorOpen, KeyRound, Wallet, Wrench, FileSignature, Plus, Receipt } from 'lucide-react';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { MoneyFlowChart } from '@/components/dashboard/MoneyFlowChart';
import { OccupancyMeter } from '@/components/dashboard/OccupancyMeter';
import { RecentActivityFeed, type ActivityItem } from '@/components/dashboard/RecentActivityFeed';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

// Owner Dashboard (UI_REDESIGN_PLAN.md, redesigned 2026-08-03; first built TASKS.md M20 priority
// 7). Composition follows the evidenced PropView pattern (PROPVIEW_SCREENSHOT_AUDIT.md: "hero
// greeting, Key Numbers KPIs, money in/out chart, recent work feed") adapted to
// reference/lovable-ui-reference's visual language (elevated panels, area chart, quick-stat link
// row) -- never PropView's or Lovable's literal branding/copy. Every number is computed live from
// real tables; nothing here is fabricated, matching the explicit "do not invent unsupported
// metrics" requirement -- there is deliberately no occupancy *trend* chart, since no historical
// occupancy snapshot table exists to compute one honestly (current occupancy is shown as a
// point-in-time meter instead).

interface DashboardData {
  totalProperties: number;
  totalUnits: number;
  vacantUnits: number;
  occupiedUnits: number;
  occupancyPct: number;
  rentCollectedThisMonth: number;
  outstandingRent: number;
  cashThisMonth: number;
  openMaintenanceCount: number;
  expiringLeasesCount: number;
  moneyFlow: { month: string; collected: number; expenses: number }[];
  activity: ActivityItem[];
}

const DEMO_DATA: DashboardData = {
  totalProperties: 4,
  totalUnits: 12,
  vacantUnits: 1,
  occupiedUnits: 11,
  occupancyPct: 92,
  rentCollectedThisMonth: 84500,
  outstandingRent: 6200,
  cashThisMonth: 10650,
  openMaintenanceCount: 3,
  expiringLeasesCount: 2,
  moneyFlow: [
    { month: 'Mar', collected: 78000, expenses: 12400 },
    { month: 'Apr', collected: 81500, expenses: 9800 },
    { month: 'May', collected: 79200, expenses: 15200 },
    { month: 'Jun', collected: 83000, expenses: 8600 },
    { month: 'Jul', collected: 82100, expenses: 11300 },
    { month: 'Aug', collected: 84500, expenses: 7400 },
  ],
  activity: [
    { id: '1', description: 'Invoice issued for Unit 4B', timestamp: new Date().toISOString() },
    { id: '2', description: 'Payment recorded for Unit 2A', timestamp: new Date().toISOString() },
    { id: '3', description: 'Maintenance ticket completed at Sunset Villas', timestamp: new Date().toISOString() },
  ],
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

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title={`${greeting()}`}
        subtitle={`Here's how your portfolio is performing in ${monthLabel}.`}
        actions={
          <>
            <Link href="/properties/new">
              <Button variant="secondary" size="sm">
                <Building2 size={15} className="mr-1.5" /> Add property
              </Button>
            </Link>
            <Link href="/accounting/bank-transactions/new">
              <Button variant="primary" size="sm">
                <Plus size={15} className="mr-1.5" /> Record payment
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <AdminMetricCard
          icon={<Wallet size={17} />}
          label="Rent collected this month"
          value={`R${data.rentCollectedThisMonth.toLocaleString('en-ZA')}`}
          hint="Confirmed bank-matched payments"
        />
        <AdminMetricCard
          icon={<Receipt size={17} />}
          label="Outstanding rent"
          value={`R${data.outstandingRent.toLocaleString('en-ZA')}`}
          hint="Invoiced, not yet matched"
        />
        <AdminMetricCard
          icon={<DoorOpen size={17} />}
          label="Occupancy rate"
          value={`${data.occupancyPct}%`}
          hint={`${data.occupiedUnits} of ${data.totalUnits} units let`}
        />
        <AdminMetricCard
          icon={<KeyRound size={17} />}
          label="Cash left this month"
          value={`${data.cashThisMonth >= 0 ? '+' : ''}R${data.cashThisMonth.toLocaleString('en-ZA')}`}
          hint="Rent collected minus expenses recorded"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <AdminMetricCard icon={<Building2 size={16} />} label="Properties" value={data.totalProperties} href="/properties" />
        <AdminMetricCard icon={<DoorOpen size={16} />} label="Units" value={data.totalUnits} href="/units" />
        <AdminMetricCard icon={<FileSignature size={16} />} label="Expiring leases" value={data.expiringLeasesCount} href="/leases" />
        <AdminMetricCard icon={<Wrench size={16} />} label="Open maintenance" value={data.openMaintenanceCount} href="/maintenance" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Rent collected vs expenses"
          description="Last 6 months, ZAR"
          bodyClassName="p-3 pt-5"
        >
          <MoneyFlowChart data={data.moneyFlow} />
        </Panel>

        <Panel title="Occupancy" description="Current portfolio-wide">
          <OccupancyMeter occupied={data.occupiedUnits} vacant={data.vacantUnits} />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Recent activity" description="Latest actions across your portfolio">
          <RecentActivityFeed items={data.activity} />
        </Panel>

        <Panel title="Quick actions">
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: 'Add property', href: '/properties/new', icon: Building2 },
              { label: 'New lease', href: '/properties', icon: FileSignature },
              { label: 'Add expense', href: '/accounting/expenses/new', icon: Receipt },
              { label: 'Log maintenance', href: '/properties', icon: Wrench },
            ].map((action) => (
              <Link
                key={action.label}
                href={action.href}
                className="flex flex-col items-start gap-2 rounded-lg border border-light-border p-3 text-left transition-colors hover:border-light-accent hover:bg-light-accentSoft dark:border-dark-border dark:hover:border-dark-accent dark:hover:bg-dark-accentSoft"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-light-accentSoft text-light-accent dark:bg-dark-accentSoft dark:text-dark-accent">
                  <action.icon size={16} />
                </span>
                <span className="text-xs font-medium text-light-textPrimary dark:text-dark-textPrimary">
                  {action.label}
                </span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

async function loadData(): Promise<DashboardData> {
  const supabase = await getServerSupabaseClient();

  const now = new Date();
  const in45Days = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayIso = now.toISOString().slice(0, 10);

  const [propertiesResult, unitsResult, rentSchedulesResult, expensesResult, maintenanceResult, auditResult, leasesResult] =
    await Promise.all([
      supabase.from('properties').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('units').select('id, status'),
      supabase.from('rent_schedules').select('due_date, amount, status'),
      supabase.from('expenses').select('created_at, amount, status'),
      supabase.from('maintenance_tickets').select('id, status').neq('status', 'completed'),
      supabase.from('audit_events').select('id, action, entity_type, created_at').order('created_at', { ascending: false }).limit(8),
      supabase.from('leases').select('id', { count: 'exact', head: true }).eq('status', 'active').gte('end_date', todayIso).lte('end_date', in45Days),
    ]);
  if (propertiesResult.error) throw new Error(`Failed to load properties: ${propertiesResult.error.message}`);
  if (unitsResult.error) throw new Error(`Failed to load units: ${unitsResult.error.message}`);
  if (rentSchedulesResult.error) throw new Error(`Failed to load rent schedule: ${rentSchedulesResult.error.message}`);
  if (expensesResult.error) throw new Error(`Failed to load expenses: ${expensesResult.error.message}`);
  if (maintenanceResult.error) throw new Error(`Failed to load maintenance: ${maintenanceResult.error.message}`);
  if (leasesResult.error) throw new Error(`Failed to load leases: ${leasesResult.error.message}`);

  const units = unitsResult.data ?? [];
  const occupiedUnits = units.filter((u) => u.status === 'occupied').length;
  const vacantUnits = units.filter((u) => u.status === 'vacant').length;
  const occupancyPct = units.length > 0 ? Math.round((occupiedUnits / units.length) * 100) : 0;

  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const thisMonthKey = monthKey(now);

  const rentSchedules = rentSchedulesResult.data ?? [];
  const expenses = expensesResult.data ?? [];

  const rentCollectedThisMonth = rentSchedules
    .filter((r) => (r.status === 'paid' || r.status === 'partial') && r.due_date.slice(0, 7) === thisMonthKey)
    .reduce((sum, r) => sum + Number(r.amount), 0);
  const outstandingRent = rentSchedules
    .filter((r) => r.status === 'invoiced' || r.status === 'overdue' || r.status === 'partial')
    .reduce((sum, r) => sum + Number(r.amount), 0);
  const expensesThisMonth = expenses
    .filter((e) => (e.status === 'recorded' || e.status === 'reimbursed') && e.created_at.slice(0, 7) === thisMonthKey)
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const moneyFlow = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const key = monthKey(d);
    const collected = rentSchedules
      .filter((r) => (r.status === 'paid' || r.status === 'partial') && r.due_date.slice(0, 7) === key)
      .reduce((sum, r) => sum + Number(r.amount), 0);
    const monthExpenses = expenses
      .filter((e) => (e.status === 'recorded' || e.status === 'reimbursed') && e.created_at.slice(0, 7) === key)
      .reduce((sum, e) => sum + Number(e.amount), 0);
    return { month: d.toLocaleDateString('en-ZA', { month: 'short' }), collected, expenses: monthExpenses };
  });

  const activity: ActivityItem[] = (auditResult.data ?? []).map((row) => ({
    id: row.id,
    description: describeAuditAction(row.action, row.entity_type),
    timestamp: row.created_at,
  }));

  return {
    totalProperties: propertiesResult.count ?? 0,
    totalUnits: units.length,
    vacantUnits,
    occupiedUnits,
    occupancyPct,
    rentCollectedThisMonth,
    outstandingRent,
    cashThisMonth: rentCollectedThisMonth - expensesThisMonth,
    openMaintenanceCount: maintenanceResult.data?.length ?? 0,
    expiringLeasesCount: leasesResult.count ?? 0,
    moneyFlow,
    activity,
  };
}

const ACTION_LABELS: Record<string, string> = {
  'email_sent': 'Notification email sent',
  'whatsapp_sent': 'WhatsApp notification sent',
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
