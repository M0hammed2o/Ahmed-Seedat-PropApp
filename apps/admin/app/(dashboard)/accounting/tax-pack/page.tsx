import { redirect } from 'next/navigation';
import { TaxPackClient } from '@/components/accounting/TaxPackClient';
import { PageHeader } from '@/components/ui/PageHeader';
import { resolvePortalSession, findActiveMembership, canPostAccountingRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

/**
 * GET /accounting/tax-pack (TASKS.md M14 part 3, API_SPEC.md §6, ACCOUNTING.md §7) -- computed
 * live, never a stored table (only the export event is logged). accountant+ only, same threshold
 * as every other Accounting-post page; a lower role sees nothing to compute against anyway since
 * compute_tax_pack() itself enforces the same check.
 */
export default async function TaxPackPage() {
  if (ADMIN_DEMO_MODE) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Tax Pack" subtitle="South African tax-year summary, computed from your ledger." />
        <TaxPackClient orgId="demo-org-1" />
      </div>
    );
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) redirect('/onboarding/create-organization');
  const membership = findActiveMembership(session, activeOrg.orgId);
  const canPost = Boolean(membership && canPostAccountingRecords(membership.role));

  if (!canPost) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Tax Pack" />
        <p className="text-sm text-light-textSecondary dark:text-dark-textSecondary">
          Only accountant, manager, and principal roles can view the tax pack.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title="Tax Pack" subtitle="South African tax-year summary, computed from your ledger." />
      <TaxPackClient orgId={activeOrg.orgId} />
    </div>
  );
}
