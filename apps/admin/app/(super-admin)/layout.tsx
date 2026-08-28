import { redirect, notFound } from 'next/navigation';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { LayoutDashboard, Users, CreditCard, ScanLine, Activity, Mail, Gift } from 'lucide-react';
import { branding } from '@propvault/config';
import { getAdminGateStatus } from '@/lib/auth';
import { resolveAuthenticatedDestination } from '@/lib/destinationResolver';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { AppShell, type NavSection } from '@/components/shell/AppShell';
import { navIcon } from '@/components/shell/navIcon';

// Platform-staff route group, matching ARCHITECTURE.md's "Why one web app, not two" naming
// exactly (`app/(super-admin)/**`, independent auth via `platform_admin_users`, never an org
// role). Every page here is session-scoped, live data — never statically prerendered or cached.
export const dynamic = 'force-dynamic';

// Super Admin separation (WORKLOG.md this date), item 9: excluded from indexing at the page-render
// level too, alongside robots.ts's Disallow rule and proxy.ts's X-Robots-Tag header -- three
// independent layers so no single omission leaves this crawlable.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const MFA_SETUP_PATH = '/platform-admin/mfa-setup';

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: '/platform-admin/overview', label: 'Overview', icon: navIcon(LayoutDashboard) },
      { href: '/platform-admin/customers', label: 'Customers', icon: navIcon(Users) },
      {
        href: '/platform-admin/subscriptions',
        label: 'Subscriptions',
        icon: navIcon(CreditCard),
      },
      { href: '/platform-admin/processing', label: 'Processing', icon: navIcon(ScanLine) },
      { href: '/platform-admin/referrals', label: 'Referrals', icon: navIcon(Gift) },
      { href: '/platform-admin/system', label: 'System', icon: navIcon(Activity) },
      {
        href: '/platform-admin/email-preview',
        label: 'Email preview',
        icon: navIcon(Mail),
      },
    ],
  },
];

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const currentPath = ADMIN_DEMO_MODE ? '' : (await headers()).get('x-pathname');

  // Re-checked here (not just in proxy.ts) per SECURITY.md — this is the fine-grained,
  // server-component-level gate. Every page under (super-admin) inherits this check.
  //
  // Super Admin separation (WORKLOG.md this date), item 4: a caller who is NOT a platform admin
  // (or not signed in at all) is never shown a 403/FORBIDDEN page here -- that used to bubble up
  // to the generic app/error.tsx boundary via requireRole()'s thrown Error, a real information
  // leak ("something you tried triggered an error page" tells a curious customer they found
  // *something*, even if it doesn't say what). Instead: a genuine other-role caller (org staff,
  // tenant, owner, or authenticated-with-nothing) is silently redirected to their own correct
  // destination via the same centralized resolver the root page uses -- they see their own
  // dashboard, never a hint the admin area exists. A caller who resolves to nothing at all
  // (fully unauthenticated -- proxy.ts should already have redirected this case to /login before
  // it ever reaches here; this is defense-in-depth for if that's ever bypassed) gets a real 404.
  // One resolution, not two -- getAdminGateStatus() returns both "is there any admin session"
  // and "is it AAL2" from a single Promise.all'd pass (see lib/auth.ts's own comment: the
  // previous two-separate-calls version's cumulative latency was the actual root cause of a
  // real Next.js concurrent-rendering race, caught live via Playwright -- the slower this gate
  // takes to redirect, the more of a head start a child page's own independent, faster
  // requireRole() check gets to throw its uncaught FORBIDDEN error first).
  const { session: adminSessionUnverified, isAal2 } = await getAdminGateStatus();
  if (!adminSessionUnverified) {
    const destination = await resolveAuthenticatedDestination();
    if (destination) {
      // Item 8: "failed access attempts" -- only logged for a genuinely authenticated, identified
      // caller (not the fully-signed-out case below, which proxy.ts should already have
      // redirected to /login before ever reaching here, and has no identity worth attributing an
      // attempt to). Fire-and-forget: writeAuditEvent already logs its own failures rather than
      // throwing, and a slow/failed audit write must never block a legitimate customer's redirect
      // to their own dashboard.
      if (!ADMIN_DEMO_MODE) {
        const supabase = await getServerSupabaseClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          void writeAuditEvent(getServiceRoleClient(), {
            orgId: null,
            actorUserId: user.id,
            actorType: 'user',
            action: 'platform_admin.access_denied',
            entityType: 'platform_admin_users',
            entityId: user.id,
          });
        }
      }
      redirect(destination.path);
    }
    notFound();
  }

  // Item 6: a real platform admin whose session hasn't reached AAL2 (never enrolled TOTP, or
  // enrolled but this session hasn't stepped up) is sent to enroll/verify -- everywhere except the
  // enrollment page itself, which would otherwise redirect-loop against the very check it exists
  // to satisfy.
  if (!isAal2) {
    if (currentPath === MFA_SETUP_PATH) {
      // Render the bare page directly, no AppShell dashboard chrome -- this is effectively a
      // pre-auth screen (same visual tier as /login), not a Super Admin dashboard page.
      return <>{children}</>;
    }
    redirect(MFA_SETUP_PATH);
  }

  return (
    <AppShell
      productLabel={`${branding.productName} Admin`}
      navSections={NAV_SECTIONS}
      identityLine={`${adminSessionUnverified.displayName} · ${adminSessionUnverified.role.replace('_', ' ')}`}
      demoBadge={ADMIN_DEMO_MODE}
      homeHref="/platform-admin/overview"
    >
      {children}
    </AppShell>
  );
}
