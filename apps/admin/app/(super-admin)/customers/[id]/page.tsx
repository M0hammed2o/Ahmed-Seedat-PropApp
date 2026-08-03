import { notFound } from 'next/navigation';
import { ORGANIZATION_STATUS_PRESENTATION } from '@propvault/ui';
import { requireRole } from '@/lib/auth';
import { isRoleAtLeast } from '@/lib/roleRank';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { getPlatformOrganizationDetail } from '@/lib/superAdmin';
import { OrganizationActionsPanel } from '@/components/organizations/OrganizationActionsPanel';
import { BillingPanel } from '@/components/organizations/BillingPanel';
import { SupportSessionControl } from '@/components/organizations/SupportSessionControl';
import { UsagePanel } from '@/components/organizations/UsagePanel';
import { AuditLogPanel } from '@/components/organizations/AuditLogPanel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { DEMO_CUSTOMERS } from '@/lib/demo/adminMockData';

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole('read_only_admin');
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    const customer = DEMO_CUSTOMERS.find((c) => c.id === id);
    if (!customer) notFound();

    return (
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
            {customer.displayName}
          </h1>
          <span className="rounded-full border border-light-accent px-3 py-1 text-xs font-semibold text-light-accent dark:border-dark-accent dark:text-dark-accent">
            Demo data
          </span>
        </div>
        <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
          {customer.email}
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Registered</dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary">
              {new Date(customer.createdAt).toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Last active</dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary">
              {new Date(customer.lastActiveAt).toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Properties</dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary">
              {customer.propertyCount}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Documents</dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary">
              {customer.documentCount}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Storage used</dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary">
              {(customer.storageUsedMb / 1024).toFixed(2)}GB
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Subscription</dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary">
              {customer.subscriptionStatus.replace('_', ' ')}
            </dd>
          </div>
        </dl>

        <p className="mt-8 text-xs text-light-textMuted dark:text-dark-textMuted">
          Suspend/reactivate, admin notes, and raw document access are architected
          (ADMIN_DASHBOARD.md, SECURITY.md) but not yet wired to a mutating action — tracked in
          TODO.md.
        </p>
      </div>
    );
  }

  const supabase = getServiceRoleClient();
  const detail = await getPlatformOrganizationDetail(supabase, id);
  if (!detail) notFound();

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        {detail.legalName}
      </h1>
      <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">{detail.orgId}</p>

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Registered</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            {new Date(detail.createdAt).toLocaleDateString()}
          </dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Properties</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            {detail.propertiesCount}
          </dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Units</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            {detail.unitsCount}
          </dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Tenants</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            {detail.tenantsCount}
          </dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Staff</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            {detail.staffCount}
          </dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Plan</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            {detail.planName ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Subscription</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            {detail.subscriptionStatus ?? 'unknown'}
          </dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Account status</dt>
          <dd><StatusBadge presentation={ORGANIZATION_STATUS_PRESENTATION[detail.status]} /></dd>
        </div>
      </dl>

      <OrganizationActionsPanel
        orgId={detail.orgId}
        legalName={detail.legalName}
        status={detail.status}
        currentUserRole={session.role}
      />

      <BillingPanel orgId={detail.orgId} currentUserRole={session.role} />

      <UsagePanel periodStart={detail.currentPeriodUsage.periodStart} totals={detail.currentPeriodUsage.totals} />

      <AuditLogPanel events={detail.recentAuditEvents} />

      <SupportSessionControl orgId={detail.orgId} canStart={isRoleAtLeast(session.role, 'support_admin')} />
    </div>
  );
}
