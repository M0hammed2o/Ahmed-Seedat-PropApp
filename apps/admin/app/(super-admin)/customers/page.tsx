import { type CustomerRow } from '@/components/tables/CustomersTable';
import { CustomersFilterClient } from '@/components/tables/CustomersFilterClient';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireRole } from '@/lib/auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { listPlatformOrganizations } from '@/lib/superAdmin';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { DEMO_CUSTOMERS } from '@/lib/demo/adminMockData';

/**
 * Rebuilt for TASKS.md M19 (SUPER_ADMIN.md §3): rows are client organizations, not individual
 * owner-operator `profiles` rows. This also resolves TECHNICAL_DEBT_REGISTER.md TD-16 /
 * RISK_REGISTER.md R-21's real, confirmed bug for this page specifically -- the old query joined
 * on `properties.owner_user_id`, which every property created through the real M6
 * `POST /api/v1/properties` route leaves null (properties are org-scoped now, not
 * owner_user_id-scoped), so it silently undercounted every org's properties. The new query never
 * references `owner_user_id` at all.
 */
async function getCustomers(): Promise<CustomerRow[]> {
  const summaries = await listPlatformOrganizations(getServiceRoleClient(), {}, { limit: 50, beforeFilter: null });
  return summaries.map((org) => ({
    id: org.orgId,
    displayName: org.legalName,
    createdAt: org.createdAt,
    propertyCount: org.propertiesCount,
    subscriptionStatus: org.subscriptionStatus ?? undefined,
  }));
}

export default async function CustomersPage() {
  await requireRole('read_only_admin');

  const customers: CustomerRow[] = ADMIN_DEMO_MODE
    ? DEMO_CUSTOMERS.map((c) => ({
        id: c.id,
        displayName: c.displayName,
        createdAt: c.createdAt,
        propertyCount: c.propertyCount,
        subscriptionStatus: c.subscriptionStatus,
      }))
    : await getCustomers();

  return (
    <div>
      <PageHeader
        title="Client Directory"
        subtitle={`${customers.length} ${ADMIN_DEMO_MODE ? 'client organizations' : 'most recently registered client organizations'}.`}
        actions={
          ADMIN_DEMO_MODE ? (
            <span className="rounded-full border border-light-accent px-3 py-1 text-xs font-semibold text-light-accent dark:border-dark-accent dark:text-dark-accent">
              Demo data
            </span>
          ) : undefined
        }
      />

      <div className="mt-6">
        <CustomersFilterClient customers={customers} />
      </div>
    </div>
  );
}
