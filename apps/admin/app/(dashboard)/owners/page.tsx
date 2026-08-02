import Link from 'next/link';
import type { Owner } from '@propvault/types';
import { OwnersTable } from '@/components/tables/OwnersTable';
import { Button } from '@/components/ui/Button';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapOwnerRow } from '@/lib/portfolio';
import { resolvePortalSession, findActiveMembership } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_OWNERS: Owner[] = [
  {
    id: 'demo-owner-1',
    orgId: 'demo-org-1',
    userId: null,
    ownerType: 'individual',
    name: 'Thabo Mokoena',
    email: 'thabo@example.com',
    phone: '+27 83 555 0199',
    bankingRef: null,
    mandateStart: null,
    mandateEnd: null,
    status: 'active',
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
  },
];

/**
 * GET /owners -- sixth module in the M20 vertical-slice sequence (TASKS.md), matching
 * PROPVIEW_SCREENSHOT_AUDIT.md's PORTFOLIO nav section (Properties, Units, Portfolio Map, Owners,
 * Valuations). Same "plain RLS-protected read" pattern as every other list page this milestone
 * (owners_select_org_or_self scopes it).
 */
export default async function OwnersPage() {
  const owners: Owner[] = ADMIN_DEMO_MODE ? DEMO_OWNERS : await loadOwners();
  const canCreate = ADMIN_DEMO_MODE ? true : await resolveCanCreate();

  const addAction = (
    <Link href="/owners/new">
      <Button variant="primary" size="sm">
        + Add owner
      </Button>
    </Link>
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">Owners</h1>
        {canCreate && owners.length > 0 ? addAction : null}
      </div>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        {owners.length} {owners.length === 1 ? 'owner' : 'owners'} across your portfolio.
      </p>
      <div className="mt-6">
        <OwnersTable data={owners} emptyAction={canCreate ? addAction : undefined} />
      </div>
    </div>
  );
}

async function loadOwners(): Promise<Owner[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('owners')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load owners: ${error.message}`);
  return (data ?? []).map(mapOwnerRow);
}

async function resolveCanCreate(): Promise<boolean> {
  const session = await resolvePortalSession();
  if (!session) return false;
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) return false;
  const membership = findActiveMembership(session, activeOrg.orgId);
  return Boolean(membership && membership.role !== 'viewer' && membership.role !== 'accountant');
}
