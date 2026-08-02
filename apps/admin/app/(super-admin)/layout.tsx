import { redirect } from 'next/navigation';
import { LayoutDashboard, Users, CreditCard, ScanLine, Activity } from 'lucide-react';
import { getAdminSession } from '@/lib/auth';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { AppShell, type NavSection } from '@/components/shell/AppShell';
import { navIcon } from '@/components/shell/navIcon';

// Platform-staff route group, matching ARCHITECTURE.md's "Why one web app, not two" naming
// exactly (`app/(super-admin)/**`, independent auth via `platform_admin_users`, never an org
// role). Every page here is session-scoped, live data — never statically prerendered or cached.
export const dynamic = 'force-dynamic';

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: '/overview', label: 'Overview', icon: navIcon(LayoutDashboard) },
      { href: '/customers', label: 'Customers', icon: navIcon(Users) },
      { href: '/subscriptions', label: 'Subscriptions', icon: navIcon(CreditCard) },
      { href: '/processing', label: 'Processing', icon: navIcon(ScanLine) },
      { href: '/system', label: 'System', icon: navIcon(Activity) },
    ],
  },
];

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  // Re-checked here (not just in proxy.ts) per SECURITY.md — this is the fine-grained,
  // server-component-level gate. Every page under (super-admin) inherits this check.
  const session = await getAdminSession();
  if (!session) {
    redirect('/login');
  }

  return (
    <AppShell
      productLabel="PropVault Admin"
      navSections={NAV_SECTIONS}
      identityLine={`${session.displayName} · ${session.role.replace('_', ' ')}`}
      demoBadge={ADMIN_DEMO_MODE}
    >
      {children}
    </AppShell>
  );
}
