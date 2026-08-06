import type { Organization, OrganizationSubscription, Plan } from '@propvault/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { PermissionDenied } from '@/components/ui/PermissionDenied';
import { OrganizationBillingView, type SubscriptionPaymentSummary } from '@/components/organizations/OrganizationBillingView';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapOrganizationRow } from '@/lib/organizations';
import { resolvePortalSession } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_ORGANIZATION: Organization = {
  id: 'demo-org-1',
  legalName: 'Demo Property Management (Pty) Ltd',
  tradingName: 'Demo Property Management',
  orgType: 'agency',
  cipcRegNo: '2020/123456/07',
  vatNo: '4123456789',
  sarsTaxNo: '9123456789',
  popiaInformationOfficer: 'Demo Officer',
  invoicePrefix: 'INV',
  depositInterestPct: 5,
  ffcNumber: 'FFC12345',
  ffcIssued: '2026-01-01',
  ffcExpires: '2027-01-01',
  status: 'trial',
  trialEndsAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const DEMO_PLANS: Plan[] = [
  { id: 'demo-plan-starter', code: 'starter', name: 'Starter', billingCycle: 'monthly', basePrice: 299, currency: 'ZAR', featureLimits: { maxProperties: 5 }, isActive: true, version: 1, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'demo-plan-professional', code: 'professional', name: 'Professional', billingCycle: 'monthly', basePrice: 699, currency: 'ZAR', featureLimits: { maxProperties: 25, ocrEnabled: true, ownerPortalEnabled: true }, isActive: true, version: 1, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'demo-plan-business', code: 'business', name: 'Business', billingCycle: 'monthly', basePrice: 1499, currency: 'ZAR', featureLimits: { maxProperties: -1, ocrEnabled: true, ownerPortalEnabled: true, apiAccess: true }, isActive: true, version: 1, createdAt: '2026-01-01T00:00:00Z' },
];

/**
 * GET /organization/billing (Stage 4 commercial-launch execution plan) -- self-serve billing
 * screen. Reachable only by the org's principal, matching the accountMenuLinks gate in
 * app/(dashboard)/layout.tsx; the two POST routes this page's client component calls
 * (.../billing/checkout, .../billing/cancel) re-enforce the identical principal-only floor
 * server-side regardless of this page-level gate (PERMISSIONS.md §5's cosmetic-UI-gate posture).
 */
export default async function OrganizationBillingPage() {
  if (ADMIN_DEMO_MODE) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Billing & subscription" subtitle="Manage your PropertyVault plan and view payment history." />
        <OrganizationBillingView organization={DEMO_ORGANIZATION} plans={DEMO_PLANS} subscription={null} payments={[]} />
      </div>
    );
  }

  const session = await resolvePortalSession();
  const activeOrg = session?.organizations.find((m) => m.status === 'active');
  if (!session || !activeOrg) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Billing & subscription" />
        <PermissionDenied message="Sign in required." />
      </div>
    );
  }
  if (activeOrg.role !== 'principal') {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Billing & subscription" />
        <PermissionDenied message="Only the organization principal can manage billing." />
      </div>
    );
  }

  const supabase = await getServerSupabaseClient();

  const [{ data: orgRow, error: orgError }, { data: planRows, error: plansError }, { data: subRows, error: subError }, { data: paymentRows, error: paymentsError }] =
    await Promise.all([
      supabase.from('organizations').select('*').eq('id', activeOrg.orgId).single(),
      supabase.from('plans').select('*').eq('is_active', true).order('base_price', { ascending: true }),
      supabase
        .from('organization_subscriptions')
        .select('*')
        .eq('org_id', activeOrg.orgId)
        .order('current_period_start', { ascending: false })
        .limit(1),
      supabase
        .from('subscription_payments')
        .select('*')
        .eq('org_id', activeOrg.orgId)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

  if (orgError || !orgRow) throw new Error(`Failed to load organization: ${orgError?.message ?? 'not found'}`);
  if (plansError) throw new Error(`Failed to load plans: ${plansError.message}`);
  if (subError) throw new Error(`Failed to load subscription: ${subError.message}`);
  if (paymentsError) throw new Error(`Failed to load payment history: ${paymentsError.message}`);

  const plans: Plan[] = (planRows ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    billingCycle: row.billing_cycle,
    basePrice: Number(row.base_price),
    currency: row.currency,
    featureLimits: row.feature_limits,
    isActive: row.is_active,
    version: row.version,
    createdAt: row.created_at,
  }));

  const subRow = (subRows ?? [])[0] ?? null;
  const subscription: OrganizationSubscription | null = subRow
    ? {
        id: subRow.id,
        orgId: subRow.org_id,
        planId: subRow.plan_id,
        priceOverride: subRow.price_override !== null ? Number(subRow.price_override) : null,
        discountPct: subRow.discount_pct !== null ? Number(subRow.discount_pct) : null,
        promotionalCredit: Number(subRow.promotional_credit),
        billingCycle: subRow.billing_cycle,
        currentPeriodStart: subRow.current_period_start,
        currentPeriodEnd: subRow.current_period_end,
        nextPaymentDate: subRow.next_payment_date,
        status: subRow.status,
        createdAt: subRow.created_at,
      }
    : null;

  const payments: SubscriptionPaymentSummary[] = (paymentRows ?? []).map((row) => ({
    id: row.id,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  }));

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title="Billing & subscription" subtitle="Manage your PropertyVault plan and view payment history." />
      <OrganizationBillingView organization={mapOrganizationRow(orgRow)} plans={plans} subscription={subscription} payments={payments} />
    </div>
  );
}
