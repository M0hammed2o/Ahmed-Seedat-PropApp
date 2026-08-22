export type PlanTier = 'starter' | 'professional' | 'business';

export interface WalkthroughStep {
  id: string;
  title: string;
  body: string;
  href: string;
  navLabel: string;
}

interface WalkthroughStepDefinition extends WalkthroughStep {
  /** Which plan tiers show this step. Undefined = every tier. */
  plans?: PlanTier[];
}

/**
 * V1 commercial UX pass -- ONE shared step sequence, filtered per plan tier, rather than three
 * separate unrelated tours ("One shared walkthrough engine, not three unrelated tours" -- the
 * exact instruction this file exists to satisfy). Order matches the product-specified principal
 * sequence: Dashboard, Properties, Units, Owners, Tenants, Leases, Payments, Documents,
 * Maintenance, Reports, Billing/plan -- Owners and Staff are Professional/Business-only (Starter
 * "is not intended for agency-style external-owner management" and has no staff-seat headroom to
 * promote); Business additionally reframes the Owners/team steps toward its own larger scale.
 */
const ALL_STEPS: WalkthroughStepDefinition[] = [
  {
    id: 'dashboard',
    title: 'Your dashboard',
    body: 'Your portfolio at a glance -- collection health, what needs attention today, and quick links to everything else.',
    href: '/dashboard',
    navLabel: 'Dashboard',
  },
  {
    id: 'properties',
    title: 'Properties',
    body: 'Every property you manage lives here -- add one, edit details, and drill into its units.',
    href: '/properties',
    navLabel: 'Properties',
  },
  {
    id: 'units',
    title: 'Units',
    body: 'Each property is made up of units -- track occupancy, rent, and which tenant is in each one.',
    href: '/units',
    navLabel: 'Units',
  },
  {
    id: 'owners',
    title: 'Owners',
    body: 'Give property owners their own portal login to see statements, documents, and distributions -- without staff access.',
    href: '/owners',
    navLabel: 'Owners',
    plans: ['professional', 'business'],
  },
  {
    id: 'staff',
    title: 'Your team',
    body: 'Invite staff and control exactly which properties each person can see and manage.',
    href: '/organization/staff',
    navLabel: 'Staff & property access',
    plans: ['professional', 'business'],
  },
  {
    id: 'tenants',
    title: 'Tenants',
    body: 'Tenant contact details, applications, and their own portal access all live here.',
    href: '/tenants',
    navLabel: 'Tenants',
  },
  {
    id: 'leases',
    title: 'Leases',
    body: 'Create and manage leases -- rent, deposit, dates, and renewal all in one place.',
    href: '/leases',
    navLabel: 'Leases',
  },
  {
    id: 'payments',
    title: 'Payments',
    body: 'Track rent collection, match bank transactions, and see who is overdue.',
    href: '/accounting',
    navLabel: 'Accounting',
  },
  {
    id: 'documents',
    title: 'Documents',
    body: 'Upload leases, bills, and statements -- OCR pulls out key fields for you to review and confirm.',
    href: '/documents',
    navLabel: 'Documents',
  },
  {
    id: 'maintenance',
    title: 'Maintenance',
    body: 'Log and track maintenance tickets from request through to completion.',
    href: '/maintenance',
    navLabel: 'Maintenance',
  },
  {
    id: 'reports',
    title: 'Reports',
    body: 'Portfolio performance and your South African tax pack, computed straight from your ledger.',
    href: '/reports',
    navLabel: 'Reports',
  },
  {
    id: 'billing',
    title: 'Billing & plan',
    body: 'Manage your plan, payment method, and add-on capacity any time from here.',
    href: '/organization/billing',
    navLabel: 'Billing & subscription',
  },
];

export function getWalkthroughSteps(planTier: PlanTier | null): WalkthroughStep[] {
  return ALL_STEPS.filter((step) => !step.plans || !planTier || step.plans.includes(planTier))
    .map(({ plans: _plans, ...step }) => step);
}
