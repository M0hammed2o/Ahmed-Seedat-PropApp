import Link from 'next/link';
import { Banknote, Building2, FileText, Sparkles, Wrench } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { mayCreatePortfolio } from '@/lib/subscriptionEntitlements';

function currency(n: number): string {
  return `R${Math.round(n).toLocaleString('en-ZA')}`;
}

interface OwnerOverview {
  propertyCount: number;
  outstandingBalance: number;
  openMaintenanceCount: number;
  documentsCount: number;
}

const DEMO_DATA: OwnerOverview = {
  propertyCount: 2,
  outstandingBalance: 4500,
  openMaintenanceCount: 1,
  documentsCount: 3,
};

/**
 * GET /owner-portal (Phase 5, commercial-launch execution plan) -- the owner-portal landing page,
 * same role in this route group as `(tenant)/portal/page.tsx` plays for the tenant portal.
 * Every figure here is a real, RLS-scoped aggregate (`has_property_access(..., 'owner')` /
 * `owner_statements_select_org_or_self`) -- no fabricated widget, matching this codebase's
 * standing "no mock data" convention.
 */
export default async function OwnerPortalHomePage() {
  const data = ADMIN_DEMO_MODE ? DEMO_DATA : await loadData();
  // Owner subscription + staff seat entitlement architecture (WORKLOG.md this date): the natural
  // landing flow only ever sends a caller with ZERO active org memberships here
  // (destinationResolver.ts -- org-dashboard takes priority when any exist), so for the common
  // visitor to this page mayCreatePortfolio() is false unless they've been explicitly granted --
  // the CTA below renders for exactly that "accepted an owner invitation, never subscribed" state
  // this page exists to serve gracefully rather than looking broken for. Stays hidden for the
  // (rarer) case of someone who already runs their own org visiting this page directly.
  const showUpgradeCta = ADMIN_DEMO_MODE
    ? true
    : !(await mayCreatePortfolio(await getServerSupabaseClient()));

  const cards = [
    {
      icon: Building2,
      title: 'My properties',
      body: `${data.propertyCount} propert${data.propertyCount === 1 ? 'y' : 'ies'} you own a share of`,
      href: '/owner-portal/properties',
    },
    {
      icon: Banknote,
      title: 'Distributions',
      body:
        data.outstandingBalance > 0
          ? `${currency(data.outstandingBalance)} outstanding`
          : 'Fully paid out',
      href: '/owner-portal/distributions',
    },
    {
      icon: Wrench,
      title: 'Maintenance',
      body:
        data.openMaintenanceCount === 0
          ? 'No open requests'
          : `${data.openMaintenanceCount} open request${data.openMaintenanceCount === 1 ? '' : 's'}`,
      href: '/owner-portal/maintenance',
    },
    {
      icon: FileText,
      title: 'Documents',
      body:
        data.documentsCount === 0
          ? 'No documents yet'
          : `${data.documentsCount} document${data.documentsCount === 1 ? '' : 's'}`,
      href: '/owner-portal/documents',
    },
  ];

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Welcome back"
        subtitle="Your properties, distributions, maintenance, and documents in one place."
      />

      <div className="mx-auto grid w-full max-w-3xl gap-4 sm:grid-cols-2">
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

      {showUpgradeCta ? (
        <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-3 rounded-card border border-light-border bg-light-surfaceRaised p-5 sm:flex-row sm:items-center sm:justify-between dark:border-dark-border dark:bg-dark-surfaceRaised">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-light-accentSoft text-light-accent dark:bg-dark-accentSoft dark:text-dark-accent">
              <Sparkles className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                Manage your own properties with Proplyst
              </p>
              <p className="mt-0.5 text-xs text-light-textMuted dark:text-dark-textMuted">
                You're viewing shared properties as an owner. Subscribe to create and manage your
                own portfolio, invite owners, and add staff.
              </p>
            </div>
          </div>
          <Link href="/onboarding/create-organization" className="shrink-0">
            <Button variant="primary">Choose a plan</Button>
          </Link>
        </div>
      ) : null}
    </div>
  );
}

async function loadData(): Promise<OwnerOverview> {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return { propertyCount: 0, outstandingBalance: 0, openMaintenanceCount: 0, documentsCount: 0 };

  const [propertiesResult, statementsResult, maintenanceResult, documentsResult] =
    await Promise.all([
      supabase.from('properties').select('id'),
      supabase.from('owner_statements').select('outstanding_balance'),
      supabase.from('maintenance_tickets').select('status'),
      supabase.from('documents').select('id').is('deleted_at', null),
    ]);
  if (propertiesResult.error)
    throw new Error(`Failed to load properties: ${propertiesResult.error.message}`);
  if (statementsResult.error)
    throw new Error(`Failed to load statements: ${statementsResult.error.message}`);
  if (maintenanceResult.error)
    throw new Error(`Failed to load maintenance: ${maintenanceResult.error.message}`);
  if (documentsResult.error)
    throw new Error(`Failed to load documents: ${documentsResult.error.message}`);

  const outstandingBalance = (statementsResult.data ?? []).reduce(
    (sum, s) => sum + Number(s.outstanding_balance),
    0,
  );
  const openMaintenanceCount = (maintenanceResult.data ?? []).filter(
    (t) => t.status !== 'completed',
  ).length;

  return {
    propertyCount: propertiesResult.data?.length ?? 0,
    outstandingBalance,
    openMaintenanceCount,
    documentsCount: documentsResult.data?.length ?? 0,
  };
}
