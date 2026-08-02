import { redirect } from 'next/navigation';
import Link from 'next/link';
import { resolveTenantSession, type TenantSession } from '@/lib/tenantSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

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

const NAV_ITEMS = [
  { href: '/my-lease', label: 'My Lease' },
  { href: '/my-payments', label: 'My Payments' },
  { href: '/my-maintenance', label: 'My Maintenance' },
  { href: '/notices', label: 'Notices' },
];

export default async function TenantPortalLayout({ children }: { children: React.ReactNode }) {
  const session: TenantSession | null = ADMIN_DEMO_MODE
    ? { userId: 'demo-tenant-user-1', tenantId: 'demo-tenant-1', orgId: 'demo-org-1' }
    : await resolveTenantSession();

  if (!session) redirect('/login');

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-light-border bg-light-surfaceRaised px-4 py-6 dark:border-dark-border dark:bg-dark-surfaceRaised">
        <p className="px-2 text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          PropertyVault
        </p>
        {ADMIN_DEMO_MODE ? (
          <span className="mx-2 mt-2 inline-block w-fit rounded-full border border-light-accent px-2 py-0.5 text-[10px] font-semibold text-light-accent dark:border-dark-accent dark:text-dark-accent">
            Demo mode
          </span>
        ) : null}
        <nav className="mt-6 flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2 py-2 text-sm text-light-textSecondary hover:bg-light-surface dark:text-dark-textSecondary dark:hover:bg-dark-surface"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
