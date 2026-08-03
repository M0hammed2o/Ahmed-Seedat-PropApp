import type { LeaseTemplate } from '@propvault/types';
import { LeaseTemplatesSettings } from '@/components/lease-templates/LeaseTemplatesSettings';
import { PageHeader } from '@/components/ui/PageHeader';
import { PermissionDenied } from '@/components/ui/PermissionDenied';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapLeaseTemplateRow } from '@/lib/leaseTemplates';
import { resolvePortalSession, findActiveMembership } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_TEMPLATES: LeaseTemplate[] = [
  {
    id: 'demo-lease-template-1',
    orgId: 'demo-org-1',
    name: 'Standard Residential Lease',
    storagePath: 'demo-org-1/lease-templates/demo.pdf',
    originalFileName: 'standard-residential-lease.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 184320,
    isDefault: true,
    status: 'active',
    supersedesId: null,
    createdBy: 'demo-user-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

/**
 * GET /organization/lease-templates -- PWA_V1_COMPLETION_PLAN.md #9. Same manager+ gate as
 * /organization/settings (PERMISSIONS.md's "Organisation settings" column) -- lease templates are
 * an org-configuration asset, not a day-to-day operational record.
 */
export default async function LeaseTemplatesPage() {
  if (ADMIN_DEMO_MODE) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Lease Templates" subtitle="Upload, replace, and manage your organization's lease templates." />
        <LeaseTemplatesSettings orgId="demo-org-1" templates={DEMO_TEMPLATES} />
      </div>
    );
  }

  const session = await resolvePortalSession();
  const activeOrg = session?.organizations.find((m) => m.status === 'active');
  if (!session || !activeOrg) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Lease Templates" />
        <PermissionDenied message="Sign in required." />
      </div>
    );
  }

  const membership = findActiveMembership(session, activeOrg.orgId);
  const canManage = Boolean(membership && (membership.role === 'principal' || membership.role === 'manager'));
  if (!canManage) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Lease Templates" />
        <PermissionDenied message="Only principals and managers can manage lease templates." />
      </div>
    );
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('lease_templates')
    .select('*')
    .eq('org_id', activeOrg.orgId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load lease templates: ${error.message}`);

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title="Lease Templates" subtitle="Upload, replace, and manage your organization's lease templates." />
      <LeaseTemplatesSettings orgId={activeOrg.orgId} templates={(data ?? []).map(mapLeaseTemplateRow)} />
    </div>
  );
}
