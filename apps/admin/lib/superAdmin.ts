import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  OrganizationStatus,
  PlatformDashboardMetrics,
  PlatformOrganizationDetail,
  PlatformOrganizationSummary,
  SubscriptionPayment,
  SupportAccessSession,
} from '@propvault/types';
import { ORGANIZATION_STATUSES } from '@propvault/types';

// Super Admin row mapping + read assembly (apps/admin/app/api/v1/admin/** -- SUPER_ADMIN.md,
// TASKS.md M19). Every function here expects the SERVICE-ROLE client -- a platform admin is not
// a member of the organizations it reads, so RLS would return nothing for a session-bound client;
// access is gated entirely at the API layer via requireRole() before any of these run, matching
// lib/auth.ts's own documented contract for getServiceRoleClient().

interface OrganizationRow {
  id: string;
  legal_name: string;
  trading_name: string | null;
  org_type: string;
  status: OrganizationStatus;
  created_at: string;
}

interface SubscriptionRow {
  id: string;
  org_id: string;
  plan_id: string;
  price_override: number | null;
  discount_pct: number | null;
  promotional_credit: number;
  billing_cycle: 'monthly' | 'annual';
  current_period_end: string;
  next_payment_date: string | null;
  status: OrganizationStatus;
}

interface PlanRow {
  id: string;
  code: string;
  name: string;
  base_price: number;
}

interface CountsRow {
  org_id: string;
  properties_count: number;
  units_count: number;
  owners_count: number;
  tenants_count: number;
  staff_count: number;
}

function assembleSummary(
  org: OrganizationRow,
  subscription: SubscriptionRow | undefined,
  plan: PlanRow | undefined,
  counts: CountsRow | undefined,
): PlatformOrganizationSummary {
  return {
    orgId: org.id,
    legalName: org.legal_name,
    tradingName: org.trading_name,
    orgType: org.org_type as PlatformOrganizationSummary['orgType'],
    status: org.status,
    createdAt: org.created_at,
    planCode: plan?.code ?? null,
    planName: plan?.name ?? null,
    billingCycle: subscription?.billing_cycle ?? null,
    effectivePrice: subscription ? (subscription.price_override ?? plan?.base_price ?? null) : null,
    discountPct: subscription?.discount_pct ?? null,
    promotionalCredit: subscription?.promotional_credit ?? null,
    subscriptionStatus: subscription?.status ?? null,
    currentPeriodEnd: subscription?.current_period_end ?? null,
    nextPaymentDate: subscription?.next_payment_date ?? null,
    propertiesCount: counts?.properties_count ?? 0,
    unitsCount: counts?.units_count ?? 0,
    ownersCount: counts?.owners_count ?? 0,
    tenantsCount: counts?.tenants_count ?? 0,
    staffCount: counts?.staff_count ?? 0,
  };
}

/**
 * The org's current subscription is the most-recent row per org (organization_subscriptions is
 * append-only per period, DATABASE.md §1) -- fetched in one batched query per page rather than
 * N+1, then reduced client-side to the latest row per org_id.
 */
async function fetchLatestSubscriptionsByOrg(
  client: SupabaseClient,
  orgIds: string[],
): Promise<Map<string, SubscriptionRow>> {
  if (orgIds.length === 0) return new Map();
  const { data, error } = await client
    .from('organization_subscriptions')
    .select('id, org_id, plan_id, price_override, discount_pct, promotional_credit, billing_cycle, current_period_end, next_payment_date, status')
    .in('org_id', orgIds)
    .order('current_period_start', { ascending: false });
  if (error) throw new Error(`Failed to fetch organization_subscriptions: ${error.message}`);

  const latestByOrg = new Map<string, SubscriptionRow>();
  for (const row of (data ?? []) as SubscriptionRow[]) {
    if (!latestByOrg.has(row.org_id)) latestByOrg.set(row.org_id, row); // first row per org_id wins (already ordered newest-first)
  }
  return latestByOrg;
}

async function fetchPlansById(client: SupabaseClient, planIds: string[]): Promise<Map<string, PlanRow>> {
  if (planIds.length === 0) return new Map();
  const { data, error } = await client.from('plans').select('id, code, name, base_price').in('id', planIds);
  if (error) throw new Error(`Failed to fetch plans: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.id as string, row as PlanRow]));
}

async function fetchCountsByOrg(client: SupabaseClient, orgIds: string[]): Promise<Map<string, CountsRow>> {
  if (orgIds.length === 0) return new Map();
  const { data, error } = await client.rpc('admin_organization_counts', { p_org_ids: orgIds });
  if (error) throw new Error(`Failed to fetch admin_organization_counts: ${error.message}`);
  return new Map((data ?? []).map((row: CountsRow) => [row.org_id, row]));
}

export interface ListOrganizationsFilters {
  status?: OrganizationStatus;
  planCode?: string;
}

export async function listPlatformOrganizations(
  client: SupabaseClient,
  filters: ListOrganizationsFilters,
  page: { limit: number; beforeFilter: string | null },
): Promise<PlatformOrganizationSummary[]> {
  // planCode is resolved to a concrete set of org ids BEFORE the paginated query runs, not
  // filtered in JS afterward -- filtering a fixed-size page in memory would silently break cursor
  // pagination (a full page of `limit` orgs could contain zero plan matches, making the caller
  // wrongly conclude there's no next page).
  let planOrgIdFilter: string[] | null = null;
  if (filters.planCode) {
    const { data: plan, error: planError } = await client.from('plans').select('id').eq('code', filters.planCode).maybeSingle();
    if (planError) throw new Error(`Failed to resolve plan code: ${planError.message}`);
    if (!plan) return []; // unknown plan code -- no organization can match it
    const { data: matchingSubs, error: subsError } = await client
      .from('organization_subscriptions')
      .select('org_id')
      .eq('plan_id', plan.id)
      .eq('status', 'active');
    if (subsError) throw new Error(`Failed to resolve plan's organizations: ${subsError.message}`);
    planOrgIdFilter = [...new Set((matchingSubs ?? []).map((row) => row.org_id as string))];
    if (planOrgIdFilter.length === 0) return [];
  }

  let query = client
    .from('organizations')
    .select('id, legal_name, trading_name, org_type, status, created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(page.limit);
  if (filters.status) query = query.eq('status', filters.status);
  if (planOrgIdFilter) query = query.in('id', planOrgIdFilter);
  if (page.beforeFilter) query = query.or(page.beforeFilter);

  const { data: orgRows, error } = await query;
  if (error) throw new Error(`Failed to list organizations: ${error.message}`);
  const orgs = (orgRows ?? []) as OrganizationRow[];
  if (orgs.length === 0) return [];

  const orgIds = orgs.map((o) => o.id);
  const [subscriptionsByOrg, counts] = await Promise.all([
    fetchLatestSubscriptionsByOrg(client, orgIds),
    fetchCountsByOrg(client, orgIds),
  ]);
  const planIds = [...new Set([...subscriptionsByOrg.values()].map((s) => s.plan_id))];
  const plansById = await fetchPlansById(client, planIds);

  return orgs.map((org) => {
    const subscription = subscriptionsByOrg.get(org.id);
    const plan = subscription ? plansById.get(subscription.plan_id) : undefined;
    return assembleSummary(org, subscription, plan, counts.get(org.id));
  });
}

export async function getPlatformOrganizationDetail(
  client: SupabaseClient,
  orgId: string,
): Promise<PlatformOrganizationDetail | null> {
  const { data: org, error: orgError } = await client
    .from('organizations')
    .select('id, legal_name, trading_name, org_type, status, created_at')
    .eq('id', orgId)
    .maybeSingle();
  if (orgError) throw new Error(`Failed to fetch organization: ${orgError.message}`);
  if (!org) return null;

  const [subscriptionsByOrg, counts, usageResult, paymentsResult] = await Promise.all([
    fetchLatestSubscriptionsByOrg(client, [orgId]),
    fetchCountsByOrg(client, [orgId]),
    client.from('usage_snapshots').select('usage_type, period, total_quantity').eq('org_id', orgId).order('period', { ascending: false }).limit(20),
    client
      .from('subscription_payments')
      .select('id, org_id, subscription_id, amount, currency, status, payment_method, provider_reference, paid_at, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);
  if (usageResult.error) throw new Error(`Failed to fetch usage_snapshots: ${usageResult.error.message}`);
  if (paymentsResult.error) throw new Error(`Failed to fetch subscription_payments: ${paymentsResult.error.message}`);

  const subscription = subscriptionsByOrg.get(orgId);
  const plansById = subscription ? await fetchPlansById(client, [subscription.plan_id]) : new Map<string, PlanRow>();
  const summary = assembleSummary(
    org as OrganizationRow,
    subscription,
    subscription ? plansById.get(subscription.plan_id) : undefined,
    counts.get(orgId),
  );

  return {
    ...summary,
    usage: (usageResult.data ?? []).map((row) => ({
      usageType: row.usage_type as string,
      period: row.period as string,
      totalQuantity: row.total_quantity as number,
    })),
    recentPayments: (paymentsResult.data ?? []).map(mapSubscriptionPaymentRow),
  };
}

function mapSubscriptionPaymentRow(row: {
  id: string;
  org_id: string;
  subscription_id: string;
  amount: number;
  currency: string;
  status: string;
  payment_method: string | null;
  provider_reference: string | null;
  paid_at: string | null;
  created_at: string;
}): SubscriptionPayment {
  return {
    id: row.id,
    orgId: row.org_id,
    subscriptionId: row.subscription_id,
    amount: row.amount,
    currency: row.currency,
    status: row.status as SubscriptionPayment['status'],
    paymentMethod: row.payment_method,
    providerReference: row.provider_reference,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  };
}

export function mapSupportAccessSessionRow(row: {
  id: string;
  platform_admin_id: string;
  org_id: string;
  reason: string;
  started_at: string;
  ended_at: string | null;
  actions_taken: SupportAccessSession['actionsTaken'];
}): SupportAccessSession {
  return {
    id: row.id,
    platformAdminId: row.platform_admin_id,
    orgId: row.org_id,
    reason: row.reason,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    actionsTaken: row.actions_taken ?? [],
  };
}

/**
 * Live-computed platform-wide dashboard metrics (SUPER_ADMIN.md §2.1). Not read from a
 * materialized snapshot -- see TECHNICAL_DEBT_REGISTER.md TD-24 for why (no scheduler exists yet
 * to keep one fresh, and a live aggregate is not actually costly at today's org counts). Churn
 * rate is deliberately excluded (SUPER_ADMIN.md §7.2 flags it as needing a dedicated helper view).
 */
export async function computePlatformMetrics(client: SupabaseClient): Promise<PlatformDashboardMetrics> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [
    orgStatusResult,
    activeSubscriptionsResult,
    paymentsThisMonthResult,
    pendingPaymentsResult,
    failedPaymentsResult,
    creditsResult,
    propertiesResult,
    unitsResult,
    ownersResult,
    tenantsResult,
    staffResult,
  ] = await Promise.all([
    client.from('organizations').select('status, created_at'),
    client.from('organization_subscriptions').select('org_id, price_override, billing_cycle, plan_id, status').eq('status', 'active'),
    client.from('subscription_payments').select('amount').eq('status', 'paid').gte('paid_at', monthStart.toISOString()),
    client.from('subscription_payments').select('amount').eq('status', 'pending'),
    client.from('subscription_payments').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
    client.from('organization_subscriptions').select('promotional_credit').eq('status', 'active'),
    client.from('properties').select('id', { count: 'exact', head: true }),
    client.from('units').select('id', { count: 'exact', head: true }),
    client.from('owners').select('id', { count: 'exact', head: true }),
    client.from('tenants').select('id', { count: 'exact', head: true }),
    client.from('organization_members').select('id', { count: 'exact', head: true }).eq('status', 'active'),
  ]);
  for (const result of [
    orgStatusResult,
    activeSubscriptionsResult,
    paymentsThisMonthResult,
    pendingPaymentsResult,
    creditsResult,
  ]) {
    if (result.error) throw new Error(`Platform metrics query failed: ${result.error.message}`);
  }
  if (failedPaymentsResult.error) throw new Error(`Platform metrics query failed: ${failedPaymentsResult.error.message}`);
  if (propertiesResult.error) throw new Error(`Platform metrics query failed: ${propertiesResult.error.message}`);
  if (unitsResult.error) throw new Error(`Platform metrics query failed: ${unitsResult.error.message}`);
  if (ownersResult.error) throw new Error(`Platform metrics query failed: ${ownersResult.error.message}`);
  if (tenantsResult.error) throw new Error(`Platform metrics query failed: ${tenantsResult.error.message}`);
  if (staffResult.error) throw new Error(`Platform metrics query failed: ${staffResult.error.message}`);

  const orgRows = (orgStatusResult.data ?? []) as Array<{ status: OrganizationStatus; created_at: string }>;
  const organizationsByStatus = Object.fromEntries(
    ORGANIZATION_STATUSES.map((status) => [status, orgRows.filter((o) => o.status === status).length]),
  ) as Record<OrganizationStatus, number>;
  const newOrganizationsThisMonth = orgRows.filter((o) => o.created_at >= monthStart.toISOString()).length;

  const activeSubs = (activeSubscriptionsResult.data ?? []) as Array<{
    org_id: string;
    price_override: number | null;
    billing_cycle: 'monthly' | 'annual';
    plan_id: string;
  }>;
  const planIds = [...new Set(activeSubs.map((s) => s.plan_id))];
  const plansById = await fetchPlansById(client, planIds);
  const mrr = activeSubs.reduce((sum, sub) => {
    const price = sub.price_override ?? plansById.get(sub.plan_id)?.base_price ?? 0;
    return sum + (sub.billing_cycle === 'annual' ? price / 12 : price);
  }, 0);

  const revenueThisMonth = ((paymentsThisMonthResult.data ?? []) as Array<{ amount: number }>).reduce(
    (sum, row) => sum + row.amount,
    0,
  );
  const outstandingRevenue = ((pendingPaymentsResult.data ?? []) as Array<{ amount: number }>).reduce(
    (sum, row) => sum + row.amount,
    0,
  );
  const totalCreditsIssued = ((creditsResult.data ?? []) as Array<{ promotional_credit: number }>).reduce(
    (sum, row) => sum + row.promotional_credit,
    0,
  );

  return {
    totalOrganizations: orgRows.length,
    organizationsByStatus,
    newOrganizationsThisMonth,
    mrr,
    arr: mrr * 12,
    revenueThisMonth,
    outstandingRevenue,
    failedPaymentsCount: failedPaymentsResult.count ?? 0,
    totalCreditsIssued,
    averageRevenuePerClient: activeSubs.length > 0 ? mrr / activeSubs.length : 0,
    totalProperties: propertiesResult.count ?? 0,
    totalUnits: unitsResult.count ?? 0,
    totalOwners: ownersResult.count ?? 0,
    totalTenants: tenantsResult.count ?? 0,
    totalActiveStaff: staffResult.count ?? 0,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Status-transition actions (activate/suspend/archive, SUPER_ADMIN.md §4). `organizations` has
 * no client update policy for platform admins (they're not org members), so this always runs
 * against the service-role client, gated by requireRole() before it's ever called. Returns the
 * updated row, or null if orgId doesn't exist (route handler maps that to 404).
 */
export async function updateOrganizationStatus(
  client: SupabaseClient,
  orgId: string,
  status: OrganizationStatus,
): Promise<{ id: string; status: OrganizationStatus } | null> {
  const { data, error } = await client
    .from('organizations')
    .update({ status })
    .eq('id', orgId)
    .select('id, status')
    .maybeSingle();
  if (error) throw new Error(`Failed to update organization status: ${error.message}`);
  return data as { id: string; status: OrganizationStatus } | null;
}
