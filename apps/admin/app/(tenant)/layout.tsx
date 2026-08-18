import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import {
  LayoutDashboard,
  FileSignature,
  Receipt,
  Wrench,
  Megaphone,
  FileText,
  ClipboardCheck,
} from 'lucide-react';
import { branding } from '@propvault/config';
import { resolveTenantSession, type TenantSession } from '@/lib/tenantSession';
import { requireCustomerMfaIfEnrolled } from '@/lib/mfaGate';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { AppShell, type NavSection } from '@/components/shell/AppShell';
import { navIcon } from '@/components/shell/navIcon';
import { TenancySwitcher } from '@/components/tenant-portal/TenancySwitcher';
import { AssistantDrawer } from '@/components/assistant/AssistantDrawer';

// Tenant-facing route group (V1 scope correction, 2026-08-01 — DECISIONS.md/PERMISSIONS.md §4).
// A third, independent identity system alongside `(dashboard)` (org staff) and `(super-admin)`
// (platform staff) -- never merged into either, per PERMISSIONS.md's "never merge role systems".
//
// Demo mode never routes here (`app/page.tsx` only checks a tenant session outside demo mode,
// same as the org-staff branch) since there's no live Supabase project to resolve a real tenant
// session against in that mode. A fixed demo tenant session is provided anyway so this route
// group is directly reachable/verifiable during a demo-mode smoke test, matching every other
// route group's demo-mode pattern.
export const dynamic = 'force-dynamic';

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: '/portal', label: 'Home', icon: navIcon(LayoutDashboard) },
      { href: '/compliance', label: 'Required Actions', icon: navIcon(ClipboardCheck) },
      { href: '/my-lease', label: 'My Lease', icon: navIcon(FileSignature) },
      { href: '/my-payments', label: 'My Payments', icon: navIcon(Receipt) },
      { href: '/my-maintenance', label: 'My Maintenance', icon: navIcon(Wrench) },
      { href: '/my-documents', label: 'My Documents', icon: navIcon(FileText) },
      { href: '/notices', label: 'Notices', icon: navIcon(Megaphone) },
    ],
  },
];

const ACCOUNT_MENU_LINKS = [{ href: '/profile', label: 'My Profile' }];

const DEMO_TENANCY = {
  tenantId: 'demo-tenant-1',
  orgId: 'demo-org-1',
  orgName: 'Demo Properties',
  propertyId: 'demo-property-1',
  propertyNickname: 'Oakwood Apartments',
  unitId: 'demo-unit-1',
  unitLabel: 'Unit 4B',
  leaseId: 'demo-tenant-lease-1',
  leaseStatus: 'active' as const,
  isActive: true,
};

export default async function TenantPortalLayout({ children }: { children: React.ReactNode }) {
  const session: TenantSession | null = ADMIN_DEMO_MODE
    ? {
        userId: 'demo-tenant-user-1',
        tenantId: DEMO_TENANCY.tenantId,
        orgId: DEMO_TENANCY.orgId,
        propertyId: DEMO_TENANCY.propertyId,
        propertyNickname: DEMO_TENANCY.propertyNickname,
        unitId: DEMO_TENANCY.unitId,
        unitLabel: DEMO_TENANCY.unitLabel,
        leaseId: DEMO_TENANCY.leaseId,
        tenancies: [DEMO_TENANCY],
      }
    : await resolveTenantSession();

  if (!session) redirect('/login');

  // Stage 3 customer MFA bypass fix (WORKLOG.md this date) -- see lib/mfaGate.ts's own comment.
  // Redirects to the dedicated challenge page (not `/login`) so the user isn't forced to
  // re-enter their password just because they navigated away mid-challenge.
  if (!ADMIN_DEMO_MODE && (await requireCustomerMfaIfEnrolled())) {
    const currentPath = (await headers()).get('x-pathname');
    redirect(
      currentPath ? `/mfa-challenge?next=${encodeURIComponent(currentPath)}` : '/mfa-challenge',
    );
  }

  // Multi-tenancy scoping pass (WORKLOG.md this date): a tenant with exactly one tenancy sees
  // the plain property/unit text (AppShell's existing sidebarSubtitle slot, unchanged visual
  // position) -- "do not show a pointless switcher." The dropdown only renders once there's
  // genuinely more than one tenancy to choose between.
  const singleTenancyLabel =
    session.tenancies.length <= 1
      ? [session.propertyNickname, session.unitLabel].filter(Boolean).join(' — ') || undefined
      : undefined;

  return (
    <AppShell
      productLabel={branding.productName}
      navSections={NAV_SECTIONS}
      demoBadge={ADMIN_DEMO_MODE}
      accountMenuLinks={ACCOUNT_MENU_LINKS}
      homeHref="/portal"
      sidebarSubtitle={singleTenancyLabel}
      sidebarFooterWidget={
        session.tenancies.length > 1 ? (
          <TenancySwitcher tenancies={session.tenancies} activeTenantId={session.tenantId} />
        ) : undefined
      }
      assistant={
        ADMIN_DEMO_MODE ? undefined : <AssistantDrawer orgId={session.orgId} variant="tenant" />
      }
    >
      {children}
    </AppShell>
  );
}
