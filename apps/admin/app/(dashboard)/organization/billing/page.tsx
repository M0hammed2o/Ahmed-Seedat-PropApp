import type { Organization, OrganizationSubscription, Plan } from '@propvault/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { PermissionDenied } from '@/components/ui/PermissionDenied';
import {
  OrganizationBillingView,
  type SubscriptionPaymentSummary,
  type SubscriptionInvoiceSummary,
  type PaymentMethodSummary,
  type CapacitySummary,
} from '@/components/organizations/OrganizationBillingView';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapOrganizationRow } from '@/lib/organizations';
import { resolvePortalSession } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { getOrganizationEntitlements, getOrgSeatSummary } from '@/lib/subscriptionEntitlements';

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
  supportContactName: null,
  supportPhone: null,
  supportEmail: null,
  communicationFooter: null,
  invoiceAddress: null,
  invoicePaymentInstructions: null,
  invoiceNotesDefault: null,
  invoiceFooter: null,
  status: 'trial',
  trialEndsAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const DEMO_CAPACITY_SUMMARY: CapacitySummary = {
  properties: { included: 5, purchased: 0, used: 2, restricted: 0, unitPrice: null },
  owners: { included: 0, purchased: 0, used: 0, restricted: 0, unitPrice: null },
  staff: { included: 1, used: 0, suspended: 0 },
};

const DEMO_PLANS: Plan[] = [
  {
    id: 'demo-plan-starter',
    code: 'starter',
    name: 'Starter',
    billingCycle: 'monthly',
    basePrice: 299,
    currency: 'ZAR',
    featureLimits: { maxProperties: 5 },
    isActive: true,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'demo-plan-professional',
    code: 'professional',
    name: 'Professional',
    billingCycle: 'monthly',
    basePrice: 699,
    currency: 'ZAR',
    featureLimits: { maxProperties: 25, ocrEnabled: true, ownerPortalEnabled: true },
    isActive: true,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'demo-plan-business',
    code: 'business',
    name: 'Business',
    billingCycle: 'monthly',
    basePrice: 1499,
    currency: 'ZAR',
    featureLimits: {
      maxProperties: -1,
      ocrEnabled: true,
      ownerPortalEnabled: true,
      apiAccess: true,
    },
    isActive: true,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
  },
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
        <PageHeader
          title="Billing & subscription"
          subtitle="Manage your Proplyst plan and view payment history."
        />
        <OrganizationBillingView
          organization={DEMO_ORGANIZATION}
          plans={DEMO_PLANS}
          subscription={null}
          payments={[]}
          invoices={[]}
          paymentMethod={null}
          hasProviderSubscriptionToken={false}
          capacitySummary={DEMO_CAPACITY_SUMMARY}
        />
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

  const [
    { data: orgRow, error: orgError },
    { data: planRows, error: plansError },
    { data: subRows, error: subError },
    { data: paymentRows, error: paymentsError },
    { data: invoiceRows, error: invoicesError },
    { data: paymentMethodRows, error: paymentMethodError },
    { count: restrictedPropertiesCount },
    { count: restrictedOwnersCount },
    { count: suspendedStaffCount },
  ] = await Promise.all([
    supabase.from('organizations').select('*').eq('id', activeOrg.orgId).single(),
    supabase
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('base_price', { ascending: true }),
    supabase
      .from('organization_subscriptions')
      .select('*')
      .eq('org_id', activeOrg.orgId)
      .order('current_period_start', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('subscription_payments')
      .select('*')
      .eq('org_id', activeOrg.orgId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('subscription_invoices')
      .select(
        '*, plans!subscription_invoices_plan_id_fkey(name), subscription_payments!subscription_invoices_subscription_payment_id_fkey(purpose)',
      )
      .eq('org_id', activeOrg.orgId)
      .order('issued_at', { ascending: false })
      .limit(50),
    supabase
      .from('payment_methods')
      .select('id, provider, status, updated_at')
      .eq('org_id', activeOrg.orgId)
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', activeOrg.orgId)
      .eq('restricted_by_plan', true),
    supabase
      .from('owners')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', activeOrg.orgId)
      .eq('restricted_by_plan', true),
    supabase
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', activeOrg.orgId)
      .eq('suspended_by_plan', true),
  ]);

  if (orgError || !orgRow)
    throw new Error(`Failed to load organization: ${orgError?.message ?? 'not found'}`);
  if (plansError) throw new Error(`Failed to load plans: ${plansError.message}`);
  if (subError) throw new Error(`Failed to load subscription: ${subError.message}`);
  if (paymentsError) throw new Error(`Failed to load payment history: ${paymentsError.message}`);
  if (invoicesError) throw new Error(`Failed to load invoices: ${invoicesError.message}`);
  if (paymentMethodError)
    throw new Error(`Failed to load payment method: ${paymentMethodError.message}`);

  const [entitlements, seatSummary] = await Promise.all([
    getOrganizationEntitlements(supabase, activeOrg.orgId),
    getOrgSeatSummary(supabase, activeOrg.orgId),
  ]);

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
    purpose: row.purpose,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  }));

  const invoices: SubscriptionInvoiceSummary[] = (invoiceRows ?? []).map((row) => ({
    id: row.id,
    invoiceNumber: row.invoice_number,
    invoiceType: row.invoice_type,
    // Overnight V1 completion pass, Part E: the R5 once-off card-verification charge is an org's
    // very first subscription_payments row, so create_subscription_invoice_for_payment() (migration
    // 20260101000108) labels its invoice invoice_type='new_subscription' the same as a genuine
    // first paid subscription -- paymentPurpose is the only real signal that distinguishes them.
    paymentPurpose:
      (row.subscription_payments as { purpose: string } | null)?.purpose ?? null,
    planName: (row.plans as { name: string } | null)?.name ?? null,
    total: Number(row.total),
    currency: row.currency,
    status: row.status,
    issuedAt: row.issued_at,
  }));

  const paymentMethod: PaymentMethodSummary | null = paymentMethodRows
    ? {
        id: paymentMethodRows.id,
        provider: paymentMethodRows.provider,
        updatedAt: paymentMethodRows.updated_at,
      }
    : null;

  const currentPlanRow = subRow ? (planRows ?? []).find((p) => p.id === subRow.plan_id) : null;
  const currentFeatureLimits = (currentPlanRow?.feature_limits ?? {}) as Record<
    string,
    number | boolean | null
  >;
  const extraPropertyPrice =
    typeof currentFeatureLimits.extraPropertyPrice === 'number'
      ? currentFeatureLimits.extraPropertyPrice
      : null;
  const extraOwnerPrice =
    typeof currentFeatureLimits.extraOwnerPrice === 'number'
      ? currentFeatureLimits.extraOwnerPrice
      : null;

  const capacitySummary: CapacitySummary = {
    properties: {
      included:
        entitlements.propertyLimit === null
          ? null
          : entitlements.propertyLimit - (subRow?.purchased_extra_properties ?? 0),
      purchased: subRow?.purchased_extra_properties ?? 0,
      used: entitlements.activePropertyCount,
      restricted: restrictedPropertiesCount ?? 0,
      unitPrice: extraPropertyPrice,
    },
    owners: {
      included:
        entitlements.ownerLimit === null
          ? null
          : entitlements.ownerLimit - (subRow?.purchased_extra_owner_slots ?? 0),
      purchased: subRow?.purchased_extra_owner_slots ?? 0,
      used: entitlements.activeOwnerCount,
      restricted: restrictedOwnersCount ?? 0,
      unitPrice: extraOwnerPrice,
    },
    staff: {
      included: seatSummary.seatLimit,
      used: seatSummary.activeBillableStaffCount,
      suspended: suspendedStaffCount ?? 0,
    },
  };

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Billing & subscription"
        subtitle="Manage your Proplyst plan and view payment history."
      />
      <OrganizationBillingView
        organization={mapOrganizationRow(orgRow)}
        plans={plans}
        subscription={subscription}
        payments={payments}
        invoices={invoices}
        paymentMethod={paymentMethod}
        hasProviderSubscriptionToken={Boolean(subRow?.provider_subscription_token)}
        capacitySummary={capacitySummary}
      />
    </div>
  );
}
