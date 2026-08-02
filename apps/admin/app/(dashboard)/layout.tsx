import { redirect } from 'next/navigation';
import Link from 'next/link';
import { resolvePortalSession } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

// Client-org-facing route group, matching ARCHITECTURE.md's "Why one web app, not two" naming
// exactly (`app/(dashboard)/**` for client orgs, `app/(super-admin)/**` for platform staff).
// Originally built at `(portal)` because a then-running `next dev` process held a lock on this
// directory (it was occupied by the Super Admin pages, built here in M19 before this naming
// distinction was caught) -- renamed to its correct final name once that process was stopped,
// see DECISIONS.md 2026-08-01.
export const dynamic = 'force-dynamic';

const NAV_ITEMS = [
  { href: '/properties', label: 'Properties' },
  { href: '/units', label: 'Units' },
  { href: '/tenants', label: 'Tenants' },
];

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = ADMIN_DEMO_MODE
    ? {
        userId: 'demo-user-1',
        organizations: [{ orgId: 'demo-org-1', role: 'principal' as const, status: 'active' as const }],
        ownerIdentities: [],
        isPlatformAdmin: false,
      }
    : await resolvePortalSession();

  if (!session) redirect('/login');

  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) redirect('/onboarding/create-organization');

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
        <p className="mt-8 px-2 text-xs text-light-textMuted dark:text-dark-textMuted">
          {activeOrg.role.replace('_', ' ')}
        </p>
      </aside>
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
