import { redirect } from 'next/navigation';
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
  Wallet,
  Landmark,
  ArrowLeftRight,
  Scale,
  HandCoins,
  FileSpreadsheet,
  FileText,
  Bell,
  Megaphone,
} from 'lucide-react';
import { resolvePortalSession } from '@/lib/orgSession';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { AppShell, type HeaderNotification, type NavSection } from '@/components/shell/AppShell';
import { navIcon } from '@/components/shell/navIcon';
import { SupportModeBanner } from '@/components/organizations/SupportModeBanner';

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
      { href: '/accounting/rent-due', label: 'Rent Due', icon: navIcon(Receipt) },
      { href: '/accounting/expenses', label: 'Expenses', icon: navIcon(Wallet) },
      { href: '/accounting/bank-accounts', label: 'Bank Accounts', icon: navIcon(Landmark) },
      { href: '/accounting/bank-transactions', label: 'Bank Transactions', icon: navIcon(ArrowLeftRight) },
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
        organizations: [{ orgId: 'demo-org-1', role: 'principal' as const, status: 'active' as const }],
        ownerIdentities: [],
        isPlatformAdmin: false,
        supportSessions: [],
      }
    : await resolvePortalSession();

  if (!session) redirect('/login');

  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) redirect('/onboarding/create-organization');

  const notifications: HeaderNotification[] = ADMIN_DEMO_MODE ? [] : await loadHeaderNotifications();

  // A support-session-derived entry is never a real membership -- treat it as read-only
  // regardless of the synthesized 'viewer' role (PWA_V1_COMPLETION_PLAN.md #12): hide the
  // manage-org links entirely (UI-layer hiding is cosmetic, PATCH endpoints/RLS are the actual
  // enforcement, but there's no reason to show a control that can only ever 403/be silently
  // filtered).
  const activeSupportSession = session.supportSessions.find((s) => s.orgId === activeOrg.orgId);
  const supportSessionOrgName = activeSupportSession ? await loadOrgLegalName(activeOrg.orgId) : undefined;
  const canManageOrg = !activeSupportSession && (activeOrg.role === 'principal' || activeOrg.role === 'manager');
  const accountMenuLinks = [
    { href: '/settings', label: 'Account settings' },
    ...(canManageOrg
      ? [
          { href: '/organization/settings', label: 'Organization settings' },
          { href: '/organization/lease-templates', label: 'Lease templates' },
        ]
      : []),
  ];

  return (
    <AppShell
      productLabel="PropertyVault"
      navSections={NAV_SECTIONS}
      identityLine={activeSupportSession ? 'support mode (read-only)' : activeOrg.role.replace('_', ' ')}
      demoBadge={ADMIN_DEMO_MODE}
      notifications={notifications}
      accountMenuLinks={accountMenuLinks}
      banner={
        activeSupportSession ? (
          <SupportModeBanner session={activeSupportSession} orgName={supportSessionOrgName} />
        ) : undefined
      }
    >
      {children}
    </AppShell>
  );
}

// The org name for the support-mode banner -- RLS-visible via has_org_role()'s new support-session
// branch (migration 20260101000057), so this plain caller-scoped read just works.
async function loadOrgLegalName(orgId: string): Promise<string | undefined> {
  const supabase = await getServerSupabaseClient();
  const { data } = await supabase.from('organizations').select('legal_name').eq('id', orgId).maybeSingle();
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
