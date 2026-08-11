import Link from 'next/link';
import { Bell, CreditCard, FileText, Home, Megaphone, User, Wrench } from 'lucide-react';
import type { Announcement } from '@propvault/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { Meter } from '@/components/ui/Meter';
import { Button } from '@/components/ui/Button';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolveTenantSession, getTenancyLeaseIds } from '@/lib/tenantSession';
import { mapAnnouncementRow } from '@/lib/notifications';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

// New page -- Lovable's reference (reference/lovable-ui-reference/.../src/routes/portal/index.tsx)
// has one combined Tenant Portal landing page; PropertyVault's tenant route group ((tenant)/) had
// no landing page at all until now, only the 5 real sub-pages a tenant landed directly on
// (previously /my-lease, per app/page.tsx's redirect). Same situation and same resolution already
// confirmed with Mohammed for the Accounting overview (2026-08-04): builds the missing landing
// page rather than skipping it, wired to real data.
//
// No "Pay rent" capability exists anywhere in this codebase -- rent is reconciled from bank
// statement imports on the landlord side (Bank Transactions), never an online tenant-initiated
// payment. Lovable's "Pay rent" button is relabelled to a real destination (My Payments) instead
// of a fabricated payment flow.

function currency(n: number): string {
  return `R${Math.round(n).toLocaleString('en-ZA')}`;
}

interface PortalOverview {
  lease: {
    unitLabel: string | null;
    propertyNickname: string | null;
    rentAmount: number;
    nextDueDate: string | null;
    nextDueAmount: number | null;
    startDate: string;
    endDate: string | null;
  } | null;
  paidCount: number;
  overdueCount: number;
  openMaintenanceCount: number;
  latestMaintenanceSummary: string | null;
  documentsCount: number;
  notices: Announcement[];
}

const DEMO_DATA: PortalOverview = {
  lease: {
    unitLabel: 'Unit 4B',
    propertyNickname: 'Oakwood Apartments',
    rentAmount: 10650,
    nextDueDate: '2026-08-01',
    nextDueAmount: 10650,
    startDate: '2026-02-01',
    endDate: '2027-01-31',
  },
  paidCount: 6,
  overdueCount: 0,
  openMaintenanceCount: 1,
  latestMaintenanceSummary: 'Kitchen tap leaking',
  documentsCount: 1,
  notices: [
    {
      id: 'demo-tenant-announcement-1',
      orgId: 'demo-org-1',
      propertyId: null,
      title: 'Scheduled water maintenance',
      body: 'Municipal water maintenance is scheduled for this Saturday, 08:00-12:00.',
      requiresAcknowledgement: false,
      publishedAt: '2026-08-01T00:00:00Z',
      expiresAt: null,
      createdAt: '2026-08-01T00:00:00Z',
    },
  ],
};

export default async function TenantPortalHomePage() {
  const data = ADMIN_DEMO_MODE ? DEMO_DATA : await loadData();

  const cards = [
    {
      icon: FileText,
      title: 'My lease',
      body: data.lease
        ? `${data.lease.propertyNickname ?? 'Property'} — ${data.lease.unitLabel ?? 'Unit'} · Ends ${
            data.lease.endDate
              ? new Date(data.lease.endDate).toLocaleDateString('en-ZA', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })
              : 'ongoing'
          }`
        : 'No lease on file',
      href: '/my-lease',
    },
    {
      icon: CreditCard,
      title: 'Payments',
      body:
        data.paidCount + data.overdueCount === 0
          ? 'No payment schedule yet'
          : `${data.paidCount} payment${data.paidCount === 1 ? '' : 's'} · ${
              data.overdueCount > 0 ? `${data.overdueCount} overdue` : 'all on time'
            }`,
      href: '/my-payments',
    },
    {
      icon: Wrench,
      title: 'Maintenance',
      body:
        data.openMaintenanceCount === 0
          ? 'No open requests'
          : `${data.openMaintenanceCount} open request${data.openMaintenanceCount === 1 ? '' : 's'}${
              data.latestMaintenanceSummary ? ` · ${data.latestMaintenanceSummary}` : ''
            }`,
      href: '/my-maintenance',
    },
    {
      icon: Home,
      title: 'Documents',
      body:
        data.documentsCount === 0
          ? 'No documents shared yet'
          : `${data.documentsCount} document${data.documentsCount === 1 ? '' : 's'} shared`,
      href: '/my-documents',
    },
  ];

  const leaseProgress = data.lease
    ? computeLeaseProgress(data.lease.startDate, data.lease.endDate)
    : null;

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Welcome back"
        subtitle="Your lease, payments, requests, and documents in one place."
      />

      <div className="mx-auto w-full max-w-3xl space-y-4">
        <Panel bodyClassName="p-6">
          {data.lease ? (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
                <div className="min-w-0">
                  <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
                    {data.lease.nextDueDate
                      ? `Rent due ${new Date(data.lease.nextDueDate).toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' })}`
                      : 'No rent currently due'}
                  </p>
                  <p className="tabular mt-1 font-display text-[32px] leading-none font-bold text-light-textPrimary dark:text-dark-textPrimary">
                    {currency(data.lease.nextDueAmount ?? data.lease.rentAmount)}
                  </p>
                  <p className="mt-2 text-xs text-light-textMuted dark:text-dark-textMuted">
                    {data.lease.unitLabel ?? 'Unit'} · {data.lease.propertyNickname ?? 'Property'}
                  </p>
                </div>
                <Link href="/my-payments">
                  <Button variant="primary" size="lg" className="shrink-0">
                    View payments
                  </Button>
                </Link>
              </div>
              {leaseProgress ? (
                <div className="mt-5 border-t border-light-border pt-4 dark:border-dark-border">
                  <div className="mb-1.5 flex justify-between text-xs">
                    <span className="text-light-textMuted dark:text-dark-textMuted">
                      Lease progress
                    </span>
                    <span className="font-medium text-light-textPrimary dark:text-dark-textPrimary">
                      {leaseProgress.elapsed} of {leaseProgress.total} months
                    </span>
                  </div>
                  <Meter
                    value={(leaseProgress.elapsed / leaseProgress.total) * 100}
                    tone="success"
                  />
                </div>
              ) : (
                <p className="mt-5 border-t border-light-border pt-4 text-xs text-light-textMuted dark:border-dark-border dark:text-dark-textMuted">
                  Month-to-month lease — no fixed end date.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-light-textMuted dark:text-dark-textMuted">
              No lease on file yet.
            </p>
          )}
        </Panel>

        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((c) => (
            <Link
              key={c.title}
              href={c.href}
              className="panel flex items-center gap-3 p-5 text-left transition-all hover:-translate-y-px hover:shadow-lift"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-light-accentSoft text-light-accent dark:bg-dark-accentSoft dark:text-dark-accent">
                <c.icon className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                  {c.title}
                </span>
                <span className="block truncate text-xs text-light-textMuted dark:text-dark-textMuted">
                  {c.body}
                </span>
              </span>
            </Link>
          ))}
        </div>

        <Panel title="Notices & announcements" bodyClassName="p-0">
          {data.notices.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-light-textMuted dark:text-dark-textMuted">
              No notices yet.
            </p>
          ) : (
            <ul className="divide-y divide-light-border dark:divide-dark-border">
              {data.notices.map((n) => (
                <li key={n.id} className="flex items-center gap-3 px-5 py-4">
                  <NoticeIcon title={n.title} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-light-textPrimary dark:text-dark-textPrimary">
                      {n.title}
                    </p>
                    <p className="text-[11px] text-light-textMuted dark:text-dark-textMuted">
                      {new Date(n.publishedAt).toLocaleDateString('en-ZA', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-light-border px-5 py-3 dark:border-dark-border">
            <Link
              href="/notices"
              className="text-xs font-medium text-light-accent dark:text-dark-accent"
            >
              View all notices
            </Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}

// Lovable assigns each mocked notice a distinct icon (Megaphone/Bell/User) purely for visual
// variety, with no real category field behind the choice. Real announcements have no icon/category
// column (public.announcements), so this picks deterministically from the title's first matched
// keyword -- a real, stable mapping from real content, never a random or fabricated assignment.
function NoticeIcon({ title }: { title: string }) {
  const lower = title.toLowerCase();
  const Icon =
    lower.includes('statement') || lower.includes('invoice')
      ? Bell
      : lower.includes('confirm') || lower.includes('contact')
        ? User
        : Megaphone;
  return (
    <Icon
      className="h-4 w-4 shrink-0 text-light-textMuted dark:text-dark-textMuted"
      aria-hidden="true"
    />
  );
}

function computeLeaseProgress(
  startDate: string,
  endDate: string | null,
): { elapsed: number; total: number } | null {
  if (!endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const now = new Date();
  const monthsBetween = (a: Date, b: Date) =>
    (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  const total = Math.max(1, monthsBetween(start, end));
  const elapsed = Math.min(total, Math.max(0, monthsBetween(start, now)));
  return { elapsed, total };
}

async function loadData(): Promise<PortalOverview> {
  const supabase = await getServerSupabaseClient();
  const session = await resolveTenantSession();
  if (!session) {
    return {
      lease: null,
      paidCount: 0,
      overdueCount: 0,
      openMaintenanceCount: 0,
      latestMaintenanceSummary: null,
      documentsCount: 0,
      notices: [],
    };
  }

  // Multi-tenancy scoping (WORKLOG.md this date): every query below is scoped to the active
  // tenancy (session.tenantId/leaseId/orgId/propertyId) rather than every row RLS alone would
  // return across every tenancy the caller holds -- the dashboard for Tenancy A must never show
  // Tenancy B's rent/maintenance/documents/notices, even for the same Auth user.
  const tenancyLeaseIds = await getTenancyLeaseIds(supabase, session.tenantId);

  let noticesQuery = supabase
    .from('announcements')
    .select('*')
    .eq('org_id', session.orgId)
    .order('published_at', { ascending: false })
    .limit(3);
  noticesQuery = session.propertyId
    ? noticesQuery.or(`property_id.is.null,property_id.eq.${session.propertyId}`)
    : noticesQuery.is('property_id', null);

  const [leaseResult, maintenanceResult, documentsResult, noticesResult] = await Promise.all([
    session.leaseId
      ? supabase
          .from('leases')
          .select('*, units(unit_label, properties(nickname))')
          .eq('id', session.leaseId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('maintenance_tickets')
      .select('summary, status, created_at')
      .or(`tenant_id.eq.${session.tenantId},submitted_by_tenant_id.eq.${session.tenantId}`)
      .order('created_at', { ascending: false }),
    tenancyLeaseIds.length > 0
      ? supabase
          .from('documents')
          .select('id')
          .is('deleted_at', null)
          .in('lease_id', tenancyLeaseIds)
      : Promise.resolve({ data: [], error: null }),
    noticesQuery,
  ]);
  if (leaseResult.error) throw new Error(`Failed to load lease: ${leaseResult.error.message}`);
  if (maintenanceResult.error)
    throw new Error(`Failed to load maintenance: ${maintenanceResult.error.message}`);
  if (documentsResult.error)
    throw new Error(`Failed to load documents: ${documentsResult.error.message}`);
  if (noticesResult.error)
    throw new Error(`Failed to load notices: ${noticesResult.error.message}`);

  const leaseRow = leaseResult.data as
    | (Record<string, unknown> & {
        id: string;
        rent_amount: number;
        start_date: string;
        end_date: string | null;
        units: { unit_label: string; properties: { nickname: string } | null } | null;
      })
    | null;

  let lease: PortalOverview['lease'] = null;
  let paidCount = 0;
  let overdueCount = 0;
  if (leaseRow) {
    const { data: rentSchedules, error: rsError } = await supabase
      .from('rent_schedules')
      .select('due_date, amount, status')
      .eq('lease_id', leaseRow.id)
      .order('due_date', { ascending: true });
    if (rsError) throw new Error(`Failed to load rent schedule: ${rsError.message}`);

    const schedules = rentSchedules ?? [];
    paidCount = schedules.filter((r) => r.status === 'paid').length;
    overdueCount = schedules.filter((r) => r.status === 'overdue').length;
    const nextDue = schedules.find(
      (r) =>
        r.status === 'pending' ||
        r.status === 'invoiced' ||
        r.status === 'overdue' ||
        r.status === 'partial',
    );

    lease = {
      unitLabel: leaseRow.units?.unit_label ?? null,
      propertyNickname: leaseRow.units?.properties?.nickname ?? null,
      rentAmount: Number(leaseRow.rent_amount),
      nextDueDate: nextDue?.due_date ?? null,
      nextDueAmount: nextDue ? Number(nextDue.amount) : null,
      startDate: leaseRow.start_date,
      endDate: leaseRow.end_date,
    };
  }

  const tickets = maintenanceResult.data ?? [];
  const openTickets = tickets.filter((t) => t.status !== 'completed');

  return {
    lease,
    paidCount,
    overdueCount,
    openMaintenanceCount: openTickets.length,
    latestMaintenanceSummary: openTickets[0]?.summary ?? null,
    documentsCount: documentsResult.data?.length ?? 0,
    notices: (noticesResult.data ?? []).map(mapAnnouncementRow),
  };
}
