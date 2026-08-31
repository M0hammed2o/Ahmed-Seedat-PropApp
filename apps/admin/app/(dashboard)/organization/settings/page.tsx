import Link from 'next/link';
import type { Organization } from '@propvault/types';
import {
  OrganizationSettingsForm,
  InvoiceSettingsForm,
} from '@/components/organizations/OrganizationSettingsForm';
import { CommunicationPreferencesPanel } from '@/components/organizations/CommunicationPreferencesPanel';
import { PageHeader } from '@/components/ui/PageHeader';
import { PermissionDenied } from '@/components/ui/PermissionDenied';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapOrganizationRow } from '@/lib/organizations';
import { resolvePortalSession, findActiveMembership } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_ORGANIZATION: Organization = {
  id: 'demo-org-1',
  legalName: 'Demo Property Management (Pty) Ltd',
  tradingName: 'Demo Property Management',
  orgType: 'agency',
  cipcRegNo: '2020/123456/07',
  vatNo: '4123456789',
  sarsTaxNo: '9123456789',
  popiaInformationOfficer: 'Demo Officer',
  invoicePrefix: 'INV',
  depositInterestPct: 5,
  ffcNumber: 'FFC12345',
  ffcIssued: '2026-01-01',
  ffcExpires: '2027-01-01',
  supportContactName: 'Demo Support',
  supportPhone: '+27000000000',
  supportEmail: 'support@example.com',
  communicationFooter: null,
  invoiceAddress: null,
  invoicePaymentInstructions: null,
  invoiceNotesDefault: null,
  invoiceFooter: null,
  status: 'active',
  trialEndsAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

/**
 * GET /organization/settings -- PWA_V1_COMPLETION_PLAN.md #8, PERMISSIONS.md's "Organisation
 * settings" column: principal/manager Full, everyone else view-only. This page hides the whole
 * form (not just disables fields) below manager -- UI-layer hiding is cosmetic only
 * (PERMISSIONS.md §5), PATCH /api/v1/organizations/:orgId re-enforces the same floor.
 */
export default async function OrganizationSettingsPage() {
  if (ADMIN_DEMO_MODE) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Organization settings" />
        <OrganizationSettingsForm organization={DEMO_ORGANIZATION} />
        <InvoiceSettingsForm organization={DEMO_ORGANIZATION} />
        <p className="text-sm text-light-textSecondary dark:text-dark-textSecondary">
          Communication branding and channel preferences aren&apos;t available in demo mode.
        </p>
      </div>
    );
  }

  const session = await resolvePortalSession();
  const activeOrg = session?.organizations.find((m) => m.status === 'active');
  if (!session || !activeOrg) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Organization settings" />
        <PermissionDenied message="Sign in required." />
      </div>
    );
  }

  const membership = findActiveMembership(session, activeOrg.orgId);
  const canManage = Boolean(
    membership && (membership.role === 'principal' || membership.role === 'manager'),
  );
  if (!canManage) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Organization settings" />
        <PermissionDenied message="Only principals and managers can edit organization settings." />
      </div>
    );
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', activeOrg.orgId)
    .single();
  if (error || !data)
    throw new Error(`Failed to load organization: ${error?.message ?? 'not found'}`);

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Organization settings"
        subtitle="Registration, tax, and trust-account details."
      />
      <OrganizationSettingsForm organization={mapOrganizationRow(data)} />
      <InvoiceSettingsForm organization={mapOrganizationRow(data)} />
      <CommunicationPreferencesPanel
        orgId={activeOrg.orgId}
        organization={mapOrganizationRow(data)}
      />
      <p className="text-sm text-light-textSecondary dark:text-dark-textSecondary">
        Manage the templates used when creating a new lease at{' '}
        <Link
          href="/organization/lease-templates"
          className="text-light-accent hover:underline dark:text-dark-accent"
        >
          Lease Templates
        </Link>
        .
      </p>
    </div>
  );
}
