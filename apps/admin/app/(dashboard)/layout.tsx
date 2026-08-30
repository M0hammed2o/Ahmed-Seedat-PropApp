import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import {
  LayoutDashboard,
  BarChart3,
  Building2,
  DoorOpen,
  UserCog,
  Users,
  FileSignature,
  ClipboardList,
  Wrench,
  ClipboardCheck,
  Receipt,
  FileStack,
  Wallet,
  Landmark,
  ArrowLeftRight,
  Scale,
  HandCoins,
  FileSpreadsheet,
  PieChart,
  FileText,
  Bell,
  Megaphone,
} from 'lucide-react';
import { branding } from '@propvault/config';
import { resolvePortalSession } from '@/lib/orgSession';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireCustomerMfaIfEnrolled } from '@/lib/mfaGate';
import { hasAcceptedCurrentLegalTerms } from '@/lib/legalConsent';
import { isProfileComplete } from '@/lib/profileCompletion';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { AppShell, type HeaderNotification, type NavSection } from '@/components/shell/AppShell';
import { navIcon } from '@/components/shell/navIcon';
import { SupportModeBanner } from '@/components/organizations/SupportModeBanner';
import { OverdueBillingBanner } from '@/components/organizations/OverdueBillingBanner';
import { WalkthroughOverlay } from '@/components/walkthrough/WalkthroughOverlay';
import { getWalkthroughSteps, type PlanTier } from '@/lib/walkthroughSteps';
import { CollectionHealthWidget } from '@/components/shell/CollectionHealthWidget';
import { AssistantDrawer } from '@/components/assistant/AssistantDrawer';

// Client-org-facing route group, matching ARCHITECTURE.md's "Why one web app, not two" naming
// exactly (`app/(dashboard)/**` for client orgs, `app/(super-admin)/**` for platform staff).
export const dynamic = 'force-dynamic';

// Grouped per DESIGN_SYSTEM.md's own flag (§"Responsive rules"): the flat 18-item list was
// already longer than PropView's own sidebar with no section structure -- first real grouping
// pass, 2026-08-02 (UI_REDESIGN_PLAN.md). Independent per-section collapse is still future work;
// this groups them, it doesn't yet let a section fold away.
const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: navIcon(LayoutDashboard) },
      { href: '/reports', label: 'Reports', icon: navIcon(BarChart3) },
    ],
  },
  {
    label: 'Portfolio',
    items: [
      { href: '/properties', label: 'Properties', icon: navIcon(Building2) },
      { href: '/units', label: 'Units', icon: navIcon(DoorOpen) },
      { href: '/owners', label: 'Owners', icon: navIcon(UserCog) },
    ],
  },
  {
    label: 'Leasing',
    items: [
      { href: '/tenants', label: 'Tenants', icon: navIcon(Users) },
      { href: '/leases', label: 'Leases', icon: navIcon(FileSignature) },
      { href: '/applications', label: 'Applications', icon: navIcon(ClipboardList) },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/maintenance', label: 'Maintenance', icon: navIcon(Wrench) },
      { href: '/inspections', label: 'Inspections', icon: navIcon(ClipboardCheck) },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/accounting', label: 'Accounting', icon: navIcon(PieChart) },
      { href: '/accounting/invoices', label: 'Invoices', icon: navIcon(FileStack) },
      { href: '/accounting/rent-due', label: 'Rent Due', icon: navIcon(Receipt) },
      { href: '/accounting/expenses', label: 'Expenses', icon: navIcon(Wallet) },
      { href: '/accounting/bank-accounts', label: 'Bank Accounts', icon: navIcon(Landmark) },
      {
        href: '/accounting/bank-transactions',
        label: 'Bank Transactions',
        icon: navIcon(ArrowLeftRight),
      },
      { href: '/accounting/owner-statements', label: 'Owner Statements', icon: navIcon(HandCoins) },
      { href: '/accounting/trial-balance', label: 'Trial Balance', icon: navIcon(Scale) },
      { href: '/accounting/tax-pack', label: 'Tax Pack', icon: navIcon(FileSpreadsheet) },
    ],
  },
  {
    label: 'Communications',
    items: [
      { href: '/documents', label: 'Documents', icon: navIcon(FileText) },
      { href: '/notifications', label: 'Notifications', icon: navIcon(Bell) },
      { href: '/announcements', label: 'Announcements', icon: navIcon(Megaphone) },
    ],
  },
];

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = ADMIN_DEMO_MODE
    ? {
        userId: 'demo-user-1',
        organizations: [
          {
            orgId: 'demo-org-1',
            role: 'principal' as const,
            status: 'active' as const,
            orgStatus: 'active' as const,
          },
        ],
        ownerIdentities: [],
        isPlatformAdmin: false,
        supportSessions: [],
      }
    : await resolvePortalSession();

  if (!session) redirect('/login');

  // `x-pathname` is set by proxy.ts (the same "compute in middleware, forward via header"
  // pattern already used for the CSP nonce) since a Server Component layout has no access to
  // Next.js's client-only usePathname(). Read once, shared by the MFA gate below and the
  // suspended-org gate further down.
  const currentPath = ADMIN_DEMO_MODE ? '' : (await headers()).get('x-pathname');

  // Stage 3 customer MFA bypass fix (WORKLOG.md this date): a session that's only reached AAL1
  // despite the account having a verified TOTP factor must not proceed past this point -- see
  // lib/mfaGate.ts's own comment for the real, live-caught vulnerability this closes. Redirects to
  // the dedicated challenge page (not `/login`) so the user isn't forced to re-enter their
  // password just because they navigated away mid-challenge; `next` preserves the page they were
  // actually trying to reach.
  if (!ADMIN_DEMO_MODE && (await requireCustomerMfaIfEnrolled())) {
    redirect(
      currentPath ? `/mfa-challenge?next=${encodeURIComponent(currentPath)}` : '/mfa-challenge',
    );
  }

  // Production signup/onboarding (WORKLOG.md this date), same defense-in-depth posture as the
  // MFA gate above: destinationResolver.ts decides where `/` sends an authenticated caller, but
  // this layout is the actual enforcement point for anyone who reaches /dashboard (or any nested
  // route) directly -- a bookmark, a stale tab, or `next` after auth. Order matches the
  // resolver's own reasoning: consent (compliance) before profile completion (product UX),
  // both before the org/onboarding check below.
  if (!ADMIN_DEMO_MODE && !(await hasAcceptedCurrentLegalTerms())) {
    redirect(
      currentPath ? `/legal-consent?next=${encodeURIComponent(currentPath)}` : '/legal-consent',
    );
  }
  if (!ADMIN_DEMO_MODE && !(await isProfileComplete())) {
    redirect(
      currentPath
        ? `/complete-account?next=${encodeURIComponent(currentPath)}`
        : '/complete-account',
    );
  }

  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) redirect('/onboarding/create-organization');

  // Root-domain routing fix, WORKLOG.md this date: a suspended/cancelled org's active member
  // must not reach any dashboard page except billing itself, which stays reachable so the org's
  // principal can actually reactivate (re-subscribe) rather than being locked out entirely.
  const isRestrictedOrg =
    activeOrg.orgStatus === 'suspended' || activeOrg.orgStatus === 'cancelled';
  if (isRestrictedOrg && currentPath !== '/organization/billing') {
    redirect('/access-restricted');
  }

  // Commercial plan restructure: the same defense-in-depth posture as the two gates above --
  // destinationResolver.ts decides where `/` sends a caller whose principal org hasn't completed
  // payment-method setup, but THIS is the actual enforcement point for anyone who bookmarks or
  // deep-links straight into /dashboard (or any nested route) instead. Scoped to principal
  // memberships only, matching resolveCustomerOnboardingGate()'s own scoping -- an invited staff
  // member or owner is never blocked by an org they don't own the billing for. Every
  // pre-existing organization was backfilled to a non-null commercial_setup_completed_at
  // (20260101000114), so this never fires for any of them.
  if (!ADMIN_DEMO_MODE && activeOrg.role === 'principal' && currentPath !== '/organization/billing/setup') {
    const supabase = await getServerSupabaseClient();
    const { data: orgRow } = await supabase
      .from('organizations')
      .select('commercial_setup_completed_at')
      .eq('id', activeOrg.orgId)
      .single();
    if (!orgRow?.commercial_setup_completed_at) {
      redirect('/organization/billing/setup');
    }
  }

  const notifications: HeaderNotification[] = ADMIN_DEMO_MODE
    ? []
    : await loadHeaderNotifications();
  const sidebarSubtitle = ADMIN_DEMO_MODE
    ? 'Demo organization · 12 units'
    : await loadSidebarSubtitle(activeOrg.orgId);
  const collectionHealth = ADMIN_DEMO_MODE
    ? DEMO_COLLECTION_HEALTH
    : await loadCollectionHealth(activeOrg.orgId);
  const displayName = ADMIN_DEMO_MODE ? undefined : await loadDisplayName();

  // A support-session-derived entry is never a real membership -- treat it as read-only
  // regardless of the synthesized 'viewer' role (PWA_V1_COMPLETION_PLAN.md #12): hide the
  // manage-org links entirely (UI-layer hiding is cosmetic, PATCH endpoints/RLS are the actual
  // enforcement, but there's no reason to show a control that can only ever 403/be silently
  // filtered).
  const activeSupportSession = session.supportSessions.find((s) => s.orgId === activeOrg.orgId);
  const supportSessionOrgName = activeSupportSession
    ? await loadOrgLegalName(activeOrg.orgId)
    : undefined;
  const canManageOrg =
    !activeSupportSession && (activeOrg.role === 'principal' || activeOrg.role === 'manager');
  // Staff security + audit hardening pass (this date): a real production walkthrough showed a
  // Manager reaching /organization/staff via this exact `canManageOrg` bundle and administering
  // staff -- not permitted under the V1 permission model. Staff & property access, and the new
  // Activity log, are now their own principal-only flag, split out of canManageOrg (which still
  // correctly gates Organization settings/Lease templates at manager+ -- those are NOT staff
  // administration and were never asked to change).
  const canManageStaff = !activeSupportSession && activeOrg.role === 'principal';
  // Billing is principal-only, stricter than canManageOrg -- it moves real money (subscription
  // checkout/cancellation), not just organization metadata, matching PATCH .../billing/*'s own
  // super_admin-only floor at the platform-admin layer.
  const canManageBilling = !activeSupportSession && activeOrg.role === 'principal';
  const accountMenuLinks = [
    { href: '/settings', label: 'Account settings' },
    ...(canManageOrg
      ? [
          { href: '/organization/settings', label: 'Organization settings' },
          { href: '/organization/lease-templates', label: 'Lease templates' },
        ]
      : []),
    ...(canManageStaff
      ? [
          { href: '/organization/staff', label: 'Staff & property access' },
          { href: '/organization/activity', label: 'Activity' },
        ]
      : []),
    ...(canManageBilling
      ? [{ href: '/organization/billing', label: 'Billing & subscription' }]
      : []),
  ];

  // V1 commercial UX pass, Phase 8 -- the interactive walkthrough. Principal-only ("only
  // principals get commercial onboarding... staff/owners/tenants must not be routed into plan
  // selection") -- an invited staff member, owner, or tenant never even fetches this data, let
  // alone sees the overlay. A support session is excluded via canManageBilling's own posture.
  const walkthroughData =
    !ADMIN_DEMO_MODE && canManageBilling ? await loadWalkthroughData(activeOrg.orgId) : null;

  return (
    <AppShell
      productLabel={branding.productName}
      navSections={NAV_SECTIONS}
      identityLine={
        activeSupportSession ? 'support mode (read-only)' : activeOrg.role.replace('_', ' ')
      }
      displayName={displayName}
      demoBadge={ADMIN_DEMO_MODE}
      notifications={notifications}
      notificationsHref="/notifications"
      accountMenuLinks={accountMenuLinks}
      homeLabel="Portfolio"
      sidebarSubtitle={sidebarSubtitle}
      sidebarFooterWidget={
        collectionHealth ? <CollectionHealthWidget {...collectionHealth} /> : undefined
      }
      banner={
        activeSupportSession ? (
          <SupportModeBanner session={activeSupportSession} orgName={supportSessionOrgName} />
        ) : activeOrg.orgStatus === 'overdue' ? (
          <OverdueBillingBanner canManageBilling={canManageBilling} />
        ) : undefined
      }
      assistant={
        ADMIN_DEMO_MODE ? undefined : <AssistantDrawer orgId={activeOrg.orgId} variant="owner" />
      }
    >
      {children}
      {walkthroughData ? (
        <WalkthroughOverlay
          orgId={activeOrg.orgId}
          steps={getWalkthroughSteps(walkthroughData.planTier)}
          autoShow={!walkthroughData.walkthroughDismissed && !walkthroughData.walkthroughCompleted}
        />
      ) : null}
    </AppShell>
  );
}

async function loadWalkthroughData(
  orgId: string,
): Promise<{ planTier: PlanTier | null; walkthroughDismissed: boolean; walkthroughCompleted: boolean }> {
  const supabase = await getServerSupabaseClient();
  const [{ data: sub }, { data: state }] = await Promise.all([
    supabase
      .from('organization_subscriptions')
      .select('plan_id, plans(code)')
      .eq('org_id', orgId)
      .order('current_period_start', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('organization_onboarding_state')
      .select('walkthrough_dismissed_at, walkthrough_completed_at')
      .eq('org_id', orgId)
      .maybeSingle(),
  ]);

  const plansRelation = sub?.plans as { code: string } | { code: string }[] | null;
  const planCode = Array.isArray(plansRelation) ? (plansRelation[0]?.code ?? null) : (plansRelation?.code ?? null);
  const planTier: PlanTier | null = planCode?.startsWith('starter')
    ? 'starter'
    : planCode?.startsWith('professional')
      ? 'professional'
      : planCode?.startsWith('business')
        ? 'business'
        : null;

  return {
    planTier,
    walkthroughDismissed: Boolean(state?.walkthrough_dismissed_at),
    walkthroughCompleted: Boolean(state?.walkthrough_completed_at),
  };
}

// The org name for the support-mode banner -- RLS-visible via has_org_role()'s new support-session
// branch (migration 20260101000057), so this plain caller-scoped read just works.
async function loadOrgLegalName(orgId: string): Promise<string | undefined> {
  const supabase = await getServerSupabaseClient();
  const { data } = await supabase
    .from('organizations')
    .select('legal_name')
    .eq('id', orgId)
    .maybeSingle();
  return data?.legal_name;
}

// Small (limit 5), real, RLS-scoped to the caller's own rows (notifications_select_own) -- same
// query shape as /notifications itself, just capped for a header popover rather than a full list.
async function loadHeaderNotifications(): Promise<HeaderNotification[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, body, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) throw new Error(`Failed to load notifications: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
  }));
}

// Real org name + real unit count in the exact visual slot Lovable's own sidebar uses for a
// fabricated "Enterprise · 412 units" tier label (Lovable-adoption batch, 2026-08-04) -- no
// PropertyVault field backs a "tier"/"plan seat count" concept in this shell, so this shows what
// actually exists instead: the org's own name and its real, current total unit count.
async function loadSidebarSubtitle(orgId: string): Promise<string | undefined> {
  const supabase = await getServerSupabaseClient();
  const [orgResult, unitsResult] = await Promise.all([
    supabase.from('organizations').select('legal_name, trading_name').eq('id', orgId).maybeSingle(),
    supabase.from('units').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
  ]);
  if (!orgResult.data) return undefined;
  const name = orgResult.data.trading_name || orgResult.data.legal_name;
  const unitCount = unitsResult.count ?? 0;
  return `${name} · ${unitCount} ${unitCount === 1 ? 'unit' : 'units'}`;
}

export interface CollectionHealthData {
  pct: number;
  outstanding: number;
  tenantsInArrears: number;
}

const DEMO_COLLECTION_HEALTH: CollectionHealthData = {
  pct: 94,
  outstanding: 6200,
  tenantsInArrears: 1,
};

// Real equivalent of Lovable's static "Collection health 94.2%" sidebar card -- this month's
// billed-vs-collected ratio and the real count of distinct leases currently carrying an
// outstanding rent_schedules row, computed the same way the dashboard's own outstanding-rent
// figure is (Lovable-adoption batch, 2026-08-04). Returns undefined (renders nothing) rather than
// a fabricated 0%/0 when the org has no rent schedules at all yet -- a true "not enough data"
// state, not a misleading zero.
async function loadCollectionHealth(orgId: string): Promise<CollectionHealthData | undefined> {
  const supabase = await getServerSupabaseClient();
  const { data: leases, error: leasesError } = await supabase
    .from('leases')
    .select('id')
    .eq('org_id', orgId)
    .eq('status', 'active');
  if (leasesError || !leases || leases.length === 0) return undefined;
  const leaseIds = leases.map((l) => l.id as string);

  const { data: schedules, error: schedulesError } = await supabase
    .from('rent_schedules')
    .select('lease_id, amount, status')
    .in('lease_id', leaseIds);
  if (schedulesError || !schedules || schedules.length === 0) return undefined;

  const billed = schedules.reduce((sum, r) => sum + Number(r.amount), 0);
  const collected = schedules
    .filter((r) => r.status === 'paid')
    .reduce((sum, r) => sum + Number(r.amount), 0);
  const outstandingRows = schedules.filter(
    (r) => r.status === 'invoiced' || r.status === 'overdue' || r.status === 'partial',
  );
  const outstanding = outstandingRows.reduce((sum, r) => sum + Number(r.amount), 0);
  const tenantsInArrears = new Set(outstandingRows.map((r) => r.lease_id)).size;
  const pct = billed > 0 ? Math.round((collected / billed) * 100) : 0;

  return { pct, outstanding, tenantsInArrears };
}

// Real display name for the shell's account button (Lovable's own shell shows a real person's
// name, not just a role) -- `profiles.display_name`, the same source PWA_V1_COMPLETION_PLAN.md
// #7's Account Settings page already reads/writes. Null when never set (new accounts) -- AppShell
// falls back to identityLine (the caller's role) in that case, never a fabricated name.
async function loadDisplayName(): Promise<string | undefined> {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return undefined;
  const { data } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();
  return data?.display_name ?? undefined;
}
