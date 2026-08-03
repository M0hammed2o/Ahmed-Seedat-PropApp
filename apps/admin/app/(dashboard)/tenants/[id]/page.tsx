import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Mail, Phone } from 'lucide-react';
import type { Tenant } from '@propvault/types';
import { TENANT_STATUS_PRESENTATION } from '@propvault/ui';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapTenantRow } from '@/lib/leasing';
import { resolvePortalSession, findActiveMembership } from '@/lib/orgSession';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

type RouteParams = { params: Promise<{ id: string }> };

const DEMO_TENANT: Tenant = {
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
};

export default async function TenantDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-tenant-1') notFound();
    return <TenantDetailView tenant={DEMO_TENANT} canEdit />;
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('tenants').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load tenant: ${error.message}`);
  if (!data) notFound();
  const tenant = mapTenantRow(data);

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, tenant.orgId) : undefined;
  const canEdit = Boolean(membership && membership.role !== 'viewer' && membership.role !== 'accountant');

  return <TenantDetailView tenant={tenant} canEdit={canEdit} />;
}

function TenantDetailView({ tenant, canEdit }: { tenant: Tenant; canEdit: boolean }) {
  return (
    <div className="space-y-6 animate-rise">
      <Link
        href="/tenants"
        className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
      >
        ← Back to tenants
      </Link>

      {/* Profile header adapted from reference/lovable-ui-reference's tenants/index.tsx detail
          panel (UI_INTEGRATION_PLAN.md) -- large avatar + name + status + contact row, in place of
          the previous bare title/status stack. */}
      <Panel bodyClassName="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar initials={initialsFor(tenant.fullName)} className="h-14 w-14 text-lg" />
            <div className="min-w-0">
              <h1 className="truncate font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
                {tenant.fullName}
              </h1>
              <div className="mt-1">
                <StatusBadge presentation={TENANT_STATUS_PRESENTATION[tenant.status]} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-light-textMuted dark:text-dark-textMuted">
                {tenant.email ? (
                  <span className="flex items-center gap-1.5">
                    <Mail size={13} aria-hidden="true" /> {tenant.email}
                  </span>
                ) : null}
                {tenant.phone ? (
                  <span className="flex items-center gap-1.5">
                    <Phone size={13} aria-hidden="true" /> {tenant.phone}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          {canEdit ? (
            <Link href={`/tenants/${tenant.id}/edit`}>
              <Button variant="secondary" size="sm">
                Edit
              </Button>
            </Link>
          ) : null}
        </div>
      </Panel>

      <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
        Leases and maintenance history for this tenant are built at the API layer (TASKS.md
        M10/M13) but not yet wired into this page — Tenants is the current vertical slice, Leases
        is next.
      </p>
    </div>
  );
}
