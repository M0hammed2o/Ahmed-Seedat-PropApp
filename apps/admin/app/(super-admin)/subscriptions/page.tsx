import { type SubscriptionRow } from '@/components/tables/SubscriptionsTable';
import { SubscriptionsFilterClient } from '@/components/tables/SubscriptionsFilterClient';
import { requireRole } from '@/lib/auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { listPlatformOrganizations } from '@/lib/superAdmin';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { DEMO_CUSTOMERS } from '@/lib/demo/adminMockData';

/**
 * Rebuilt for TASKS.md M19 (SUPER_ADMIN.md §3/§5): reads organization_subscriptions/plans, not
 * the old per-user `subscriptions` table -- see SubscriptionsTable.tsx's own note. Demo mode
 * keeps using DEMO_CUSTOMERS (adapted to the new row shape here) since it's cosmetic-only demo
 * data, not the real data path this milestone's fix targets.
 */
export default async function SubscriptionsPage() {
  await requireRole('read_only_admin');

  const data: SubscriptionRow[] = ADMIN_DEMO_MODE
    ? DEMO_CUSTOMERS.map((c) => ({
        orgId: c.id,
        legalName: c.displayName,
        planName: 'PropertyVault Base',
        effectivePrice: 499,
        discountPct: null,
        subscriptionStatus: c.subscriptionStatus,
        currentPeriodEnd: new Date(
          new Date(c.createdAt).getTime() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      }))
    : (
        await listPlatformOrganizations(getServiceRoleClient(), {}, { limit: 50, beforeFilter: null })
      ).map((org) => ({
        orgId: org.orgId,
        legalName: org.legalName,
        planName: org.planName,
        effectivePrice: org.effectivePrice,
        discountPct: org.discountPct,
        subscriptionStatus: org.subscriptionStatus,
        currentPeriodEnd: org.currentPeriodEnd,
      }));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Subscriptions
        </h1>
        {ADMIN_DEMO_MODE ? (
          <span className="rounded-full border border-light-accent px-3 py-1 text-xs font-semibold text-light-accent dark:border-dark-accent dark:text-dark-accent">
            Demo data
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        Plan/price/discount changes and credits are issued from an organization's detail page, not
        here — see DECISIONS.md.
      </p>
      <div className="mt-6">
        <SubscriptionsFilterClient subscriptions={data} />
      </div>
    </div>
  );
}
