import { redirect } from 'next/navigation';
import { LayoutDashboard, Building2, Banknote, FileText, Wrench, History } from 'lucide-react';
import { branding } from '@propvault/config';
import { resolveOwnerSession, type OwnerSession } from '@/lib/ownerSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { AppShell, type NavSection } from '@/components/shell/AppShell';
import { navIcon } from '@/components/shell/navIcon';

// Owner-facing route group (Phase 5, commercial-launch execution plan — WORKLOG.md 2026-08-05).
// A fourth, independent identity system alongside `(dashboard)` (org staff), `(tenant)`, and
// `(super-admin)` -- never merged into any of them, per PERMISSIONS.md's "never merge role
// systems", mirroring `(tenant)/layout.tsx` exactly. Routes are nested under `/owner-portal/*`
// rather than flat `my-*` paths like the tenant portal -- Next.js resolves page paths across every
// route group regardless of the parenthesized folder name, and the tenant portal already claims
// `/my-documents`/`/my-maintenance`/`/portal`; nesting avoids any collision risk entirely rather
// than hunting for non-colliding flat names one at a time.
//
// Demo mode never routes here for the same reason it never routes to `(tenant)`: no live Supabase
// project to resolve a real owner session against. A fixed demo session is provided anyway so
// this route group is directly reachable/verifiable during a demo-mode smoke test.
export const dynamic = 'force-dynamic';

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: '/owner-portal', label: 'Home', icon: navIcon(LayoutDashboard) },
      { href: '/owner-portal/properties', label: 'My Properties', icon: navIcon(Building2) },
      { href: '/owner-portal/distributions', label: 'Distributions', icon: navIcon(Banknote) },
      { href: '/owner-portal/documents', label: 'Documents', icon: navIcon(FileText) },
      { href: '/owner-portal/maintenance', label: 'Maintenance', icon: navIcon(Wrench) },
      { href: '/owner-portal/activity', label: 'Activity', icon: navIcon(History) },
    ],
  },
];

export default async function OwnerPortalLayout({ children }: { children: React.ReactNode }) {
  const session: OwnerSession | null = ADMIN_DEMO_MODE
    ? { userId: 'demo-owner-user-1', ownerId: 'demo-owner-1', orgId: 'demo-org-1' }
    : await resolveOwnerSession();

  if (!session) redirect('/login');

  return (
    <AppShell
      productLabel={branding.productName}
      navSections={NAV_SECTIONS}
      demoBadge={ADMIN_DEMO_MODE}
    >
      {children}
    </AppShell>
  );
}
