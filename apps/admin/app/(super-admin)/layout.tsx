import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdminSession } from '@/lib/auth';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

// Platform-staff route group, matching ARCHITECTURE.md's "Why one web app, not two" naming
// exactly (`app/(super-admin)/**`, independent auth via `platform_admin_users`, never an org
// role). Renamed from `(dashboard)` 2026-08-01 once the file-watcher lock blocking it was
// cleared — see DECISIONS.md. Every page here is session-scoped, live data — never statically
// prerendered or cached.
export const dynamic = 'force-dynamic';

const NAV_ITEMS = [
  { href: '/overview', label: 'Overview' },
  { href: '/customers', label: 'Customers' },
  { href: '/subscriptions', label: 'Subscriptions' },
  { href: '/processing', label: 'Processing' },
  { href: '/system', label: 'System' },
];

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  // Re-checked here (not just in middleware) per SECURITY.md — this is the fine-grained,
  // server-component-level gate. Every page under (super-admin) inherits this check.
  const session = await getAdminSession();
  if (!session) {
    redirect('/login');
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-light-border bg-light-surfaceRaised px-4 py-6 dark:border-dark-border dark:bg-dark-surfaceRaised">
        <p className="px-2 text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          PropVault Admin
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
          {session.displayName} · {session.role.replace('_', ' ')}
        </p>
      </aside>
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
