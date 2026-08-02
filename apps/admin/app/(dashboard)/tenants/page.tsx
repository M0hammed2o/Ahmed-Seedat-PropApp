import Link from 'next/link';
import type { Tenant } from '@propvault/types';
import { TenantsTable } from '@/components/tables/TenantsTable';
import { Button } from '@/components/ui/Button';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapTenantRow } from '@/lib/leasing';
import { resolvePortalSession, findActiveMembership } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_TENANTS: Tenant[] = [
  {
    id: 'demo-tenant-1',
    orgId: 'demo-org-1',
    userId: null,
    fullName: 'Naledi Khumalo',
    email: 'naledi@example.com',
    phone: '+27 82 555 0134',
    idNumberRef: null,
    status: 'active',
    createdAt: '2026-06-05T00:00:00Z',
    updatedAt: '2026-06-05T00:00:00Z',
  },
];

/**
 * GET /tenants -- third module in the (dashboard) vertical-slice sequence (TASKS.md M20), same
 * "plain RLS-protected read" pattern as /properties (tenants_select_org_or_self scopes this to
 * the caller's org memberships automatically).
 */
export default async function TenantsPage() {
  const tenants: Tenant[] = ADMIN_DEMO_MODE ? DEMO_TENANTS : await loadTenants();
  const canCreate = ADMIN_DEMO_MODE ? true : await resolveCanCreate();

  const addAction = (
    <Link href="/tenants/new">
      <Button variant="primary" size="sm">
        + Add tenant
      </Button>
    </Link>
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">Tenants</h1>
        {canCreate && tenants.length > 0 ? addAction : null}
      </div>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        {tenants.length} {tenants.length === 1 ? 'tenant' : 'tenants'} across your portfolio.
      </p>
      <div className="mt-6">
        <TenantsTable data={tenants} emptyAction={canCreate ? addAction : undefined} />
      </div>
    </div>
  );
}

async function loadTenants(): Promise<Tenant[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('tenants').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load tenants: ${error.message}`);
  return (data ?? []).map(mapTenantRow);
}

async function resolveCanCreate(): Promise<boolean> {
  const session = await resolvePortalSession();
  if (!session) return false;
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) return false;
  const membership = findActiveMembership(session, activeOrg.orgId);
  return Boolean(membership && membership.role !== 'viewer' && membership.role !== 'accountant');
}
