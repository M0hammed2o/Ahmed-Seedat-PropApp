import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AiConversation,
  AiMessage,
  AssembledOrgContext,
  PortfolioInsight,
  StagedChange,
  UsageEvent,
  UsageSnapshot,
} from '@propvault/types';

// AI-domain row mapping + context assembly (apps/admin/app/api/v1/{ai,insights} --
// AI_ARCHITECTURE.md §1, TASKS.md M18).

interface AiConversationRow {
  id: string;
  org_id: string;
  user_id: string;
  started_at: string;
}

export function mapAiConversationRow(row: AiConversationRow): AiConversation {
  return { id: row.id, orgId: row.org_id, userId: row.user_id, startedAt: row.started_at };
}

interface AiMessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  staged_changes: StagedChange | null;
  confirmed: boolean;
  created_at: string;
}

export function mapAiMessageRow(row: AiMessageRow): AiMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    stagedChanges: row.staged_changes,
    confirmed: row.confirmed,
    createdAt: row.created_at,
  };
}

interface PortfolioInsightRow {
  id: string;
  org_id: string;
  insight_type: string;
  message: string;
  data_source: Record<string, unknown>;
  severity: 'info' | 'warning' | 'urgent';
  generated_at: string;
  dismissed_at: string | null;
}

export function mapPortfolioInsightRow(row: PortfolioInsightRow): PortfolioInsight {
  return {
    id: row.id,
    orgId: row.org_id,
    insightType: row.insight_type as PortfolioInsight['insightType'],
    message: row.message,
    dataSource: row.data_source,
    severity: row.severity,
    generatedAt: row.generated_at,
    dismissedAt: row.dismissed_at,
  };
}

interface UsageEventRow {
  id: string;
  org_id: string;
  usage_type: UsageEvent['usageType'];
  quantity: number;
  related_entity_type: string | null;
  related_entity_id: string | null;
  recorded_at: string;
}

export function mapUsageEventRow(row: UsageEventRow): UsageEvent {
  return {
    id: row.id,
    orgId: row.org_id,
    usageType: row.usage_type,
    quantity: row.quantity,
    relatedEntityType: row.related_entity_type,
    relatedEntityId: row.related_entity_id,
    recordedAt: row.recorded_at,
  };
}

interface UsageSnapshotRow {
  id: string;
  org_id: string;
  period: string;
  usage_type: UsageSnapshot['usageType'];
  total_quantity: number;
  computed_at: string;
}

export function mapUsageSnapshotRow(row: UsageSnapshotRow): UsageSnapshot {
  return {
    id: row.id,
    orgId: row.org_id,
    period: row.period,
    usageType: row.usage_type,
    totalQuantity: row.total_quantity,
    computedAt: row.computed_at,
  };
}

function addDays(date: Date, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: Date): number {
  const fromMs = new Date(`${from}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((to.getTime() - fromMs) / 86_400_000));
}

/**
 * Resolves each lease's primary tenant's full_name in one batched query, rather than N+1 queries
 * per lease -- matches the pagination/batching discipline used elsewhere in this codebase.
 */
async function getPrimaryTenantNames(
  supabase: SupabaseClient,
  leaseIds: string[],
): Promise<Record<string, string>> {
  if (leaseIds.length === 0) return {};
  const { data, error } = await supabase
    .from('lease_tenants')
    .select('lease_id, tenants(full_name)')
    .in('lease_id', leaseIds)
    .eq('is_primary', true);
  if (error) throw new Error(`Failed to resolve tenant names: ${error.message}`);

  const names: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{
    lease_id: string;
    tenants: { full_name: string } | { full_name: string }[] | null;
  }>) {
    const tenant = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
    if (tenant?.full_name) names[row.lease_id] = tenant.full_name;
  }
  return names;
}

/**
 * Server-side context assembly (AI_ARCHITECTURE.md §1.4, hard requirement) -- `supabase` MUST be
 * the acting user's own session-bound client (never the service-role client), so every query
 * below is independently RLS-scoped on top of the explicit `org_id` filter. A bug in this
 * function's org-scoping is therefore not by itself a cross-tenant leak; RLS is the backstop.
 */
export async function assembleOrgContext(
  supabase: SupabaseClient,
  orgId: string,
): Promise<AssembledOrgContext> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekOut = addDays(now, 7);
  const leaseLookaheadOut = addDays(now, 60);

  const [overdueResult, dueSoonResult, expensesResult, ticketsResult, expiringLeasesResult] =
    await Promise.all([
      supabase
        .from('rent_schedules')
        .select('lease_id, amount, due_date')
        .eq('org_id', orgId)
        .eq('status', 'overdue')
        .order('due_date', { ascending: true })
        .limit(10),
      supabase
        .from('rent_schedules')
        .select('lease_id, amount, due_date')
        .eq('org_id', orgId)
        .eq('status', 'pending')
        .gte('due_date', today)
        .lte('due_date', weekOut)
        .order('due_date', { ascending: true })
        .limit(10),
      supabase
        .from('expenses')
        .select('id, category, amount, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('maintenance_tickets')
        .select('id, summary, priority, status')
        .eq('org_id', orgId)
        .in('status', ['to_do', 'in_progress', 'pending_approval'])
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('leases')
        .select('id, end_date')
        .eq('org_id', orgId)
        .eq('status', 'active')
        .not('end_date', 'is', null)
        .lte('end_date', leaseLookaheadOut)
        .order('end_date', { ascending: true })
        .limit(10),
    ]);

  for (const result of [
    overdueResult,
    dueSoonResult,
    expensesResult,
    ticketsResult,
    expiringLeasesResult,
  ]) {
    if (result.error) throw new Error(`Context assembly query failed: ${result.error.message}`);
  }

  const overdueRows = overdueResult.data ?? [];
  const dueSoonRows = dueSoonResult.data ?? [];
  const expiringLeaseRows = expiringLeasesResult.data ?? [];

  const tenantNames = await getPrimaryTenantNames(supabase, [
    ...overdueRows.map((r) => r.lease_id as string),
    ...dueSoonRows.map((r) => r.lease_id as string),
    ...expiringLeaseRows.map((r) => r.id as string),
  ]);

  return {
    orgId,
    generatedAt: now.toISOString(),
    rentOverdue: overdueRows.map((r) => ({
      leaseId: r.lease_id as string,
      tenantName: tenantNames[r.lease_id as string] ?? 'Unknown tenant',
      amount: r.amount as number,
      daysOverdue: daysBetween(r.due_date as string, now),
    })),
    rentDueSoon: dueSoonRows.map((r) => ({
      leaseId: r.lease_id as string,
      tenantName: tenantNames[r.lease_id as string] ?? 'Unknown tenant',
      amount: r.amount as number,
      dueDate: r.due_date as string,
    })),
    recentExpenses: (expensesResult.data ?? []).map((r) => ({
      expenseId: r.id as string,
      category: r.category as string,
      amount: r.amount as number,
      recordedAt: r.created_at as string,
    })),
    openMaintenanceTickets: (ticketsResult.data ?? []).map((r) => ({
      ticketId: r.id as string,
      title: r.summary as string,
      priority: r.priority as string,
      status: r.status as string,
    })),
    leasesExpiringSoon: expiringLeaseRows.map((r) => ({
      leaseId: r.id as string,
      tenantName: tenantNames[r.id as string] ?? 'Unknown tenant',
      endDate: r.end_date as string,
    })),
  };
}

const STAGED_ENDPOINT_PATTERN = /^\/api\/v1\/[a-zA-Z0-9\-/]+$/;

/**
 * A staged change's `endpoint` is written by the LLM provider's output (mock today; real vendor
 * output tomorrow). It is never trusted as a real URL -- validated as a bare relative
 * `/api/v1/...` path with no protocol/host/query component before the confirm route is allowed
 * to fetch it, closing an SSRF/open-redirect vector a future prompt-injected LLM response could
 * otherwise exploit (see DECISIONS.md's general lesson about not trusting model-shaped output as
 * safe by construction).
 */
export function isValidStagedEndpoint(endpoint: string): boolean {
  return STAGED_ENDPOINT_PATTERN.test(endpoint);
}

/**
 * AI_ARCHITECTURE.md §4's enforcement point: checks the org's current-calendar-month `ai_token`
 * usage against `plans.feature_limits.aiMonthlyTokenCap` (a numeric cap key; absent/non-numeric
 * means unlimited -- no plan has this key configured yet, since actual cap numbers are a pricing
 * decision, `SUBSCRIPTIONS.md`, not something to invent here). Sums `usage_events` directly rather
 * than reading `usage_snapshots`, because the scheduled rollup job that would populate snapshots
 * doesn't exist yet (same missing-cron-infrastructure gap as TECHNICAL_DEBT_REGISTER.md TD-20) --
 * summing events directly is correct today and should switch to reading snapshots once that job
 * exists, for the same reason `SUPER_ADMIN.md` dashboards are meant to.
 */
export async function checkAiUsageCap(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ allowed: boolean; capExceeded: boolean }> {
  const { data: subscription, error: subError } = await supabase
    .from('organization_subscriptions')
    .select('plan_id')
    .eq('org_id', orgId)
    .maybeSingle();
  if (subError)
    throw new Error(`Failed to resolve organization_subscriptions: ${subError.message}`);
  if (!subscription) return { allowed: true, capExceeded: false }; // no subscription row yet -- unlimited, matches "absent = unlimited"

  const { data: plan, error: planError } = await supabase
    .from('plans')
    .select('feature_limits')
    .eq('id', subscription.plan_id)
    .maybeSingle();
  if (planError) throw new Error(`Failed to resolve plan: ${planError.message}`);

  const cap = (plan?.feature_limits as Record<string, unknown> | null)?.aiMonthlyTokenCap;
  if (typeof cap !== 'number') return { allowed: true, capExceeded: false };

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const { data: events, error: eventsError } = await supabase
    .from('usage_events')
    .select('quantity')
    .eq('org_id', orgId)
    .eq('usage_type', 'ai_token')
    .gte('recorded_at', monthStart.toISOString());
  if (eventsError) throw new Error(`Failed to sum usage_events: ${eventsError.message}`);

  const usedThisMonth = (events ?? []).reduce((sum, row) => sum + (row.quantity as number), 0);
  return { allowed: usedThisMonth < cap, capExceeded: usedThisMonth >= cap };
}
