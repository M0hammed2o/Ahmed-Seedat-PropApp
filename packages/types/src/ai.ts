import type {
  AiMessageRole,
  PortfolioInsightSeverity,
  PortfolioInsightType,
  UsageType,
} from './enums';
import type { ProviderError } from './documentIntelligence';

// AI_ARCHITECTURE.md §1: Conversational Assistant data model + vendor-agnostic LLM provider
// boundary, mirroring DocumentIntelligenceProvider/EmailProvider/WhatsAppProvider's shape.

export type { ProviderError };

export interface AiConversation {
  id: string;
  orgId: string;
  userId: string;
  startedAt: string;
}

// A proposed write staged by the Assistant (AI_ARCHITECTURE.md §1.5) -- the shape of the typed
// API call it intends to make, never applied until POST /ai/messages/:id/confirm re-enters that
// exact endpoint (§1.6). Never a raw SQL statement or table name -- only ever a call into an
// existing, independently-validated typed endpoint.
export interface StagedChange {
  endpoint: string; // e.g. "/api/v1/expenses"
  method: 'POST' | 'PATCH' | 'DELETE';
  body: Record<string, unknown>;
  summary: string; // human-readable description rendered in the chat UI before confirm
}

export interface AiMessage {
  id: string;
  conversationId: string;
  role: AiMessageRole;
  content: string;
  stagedChanges: StagedChange | null;
  confirmed: boolean;
  createdAt: string;
}

// Server-side context-assembly output (AI_ARCHITECTURE.md §1.4) -- plain data assembled from the
// same RLS-scoped queries the acting user's session could already run, never a raw/admin/
// service-role query result. Passed to the LLM provider as data, never as instructions.
//
// Final pre-UAT engineering pass (WORKLOG.md this date), Part 8: each field below corresponds to
// exactly one named, fixed, read-only "tool" in the approved registry (lib/ai.ts) -- getPortfolioSummary
// (rentOverdue+rentDueSoon+openMaintenanceTickets+leasesExpiringSoon rolled up), getOutstandingRent
// (rentOverdue+rentDueSoon), getPendingPaymentReports, getExpiringLeases (leasesExpiringSoon),
// getOpenMaintenance (openMaintenanceTickets), getPortfolioInsights, getRecentPayments,
// getOccupancySummary. All fetched together per turn (never a dynamic model-chosen query, never
// arbitrary SQL, never a client-supplied org id) since there is no real LLM provider to make lazy
// tool-selection meaningful yet (§3, vendor undecided) -- a disclosed simplification, not a gap.
export interface AssembledOrgContext {
  kind: 'owner';
  orgId: string;
  generatedAt: string;
  rentOverdue: Array<{ leaseId: string; tenantName: string; amount: number; daysOverdue: number }>;
  rentDueSoon: Array<{ leaseId: string; tenantName: string; amount: number; dueDate: string }>;
  recentExpenses: Array<{
    expenseId: string;
    category: string;
    amount: number;
    recordedAt: string;
  }>;
  openMaintenanceTickets: Array<{
    ticketId: string;
    title: string;
    priority: string;
    status: string;
  }>;
  leasesExpiringSoon: Array<{ leaseId: string; tenantName: string; endDate: string }>;
  /** getPendingPaymentReports -- tenant/staff-reported payments awaiting accountant+ confirmation. */
  pendingPaymentReports: Array<{
    reportId: string;
    tenantName: string;
    amount: number;
    paymentDate: string;
  }>;
  /** getPortfolioInsights -- the existing deterministic rules-engine feed (portfolio_insights),
   *  never re-derived or re-judged by the LLM -- see AI_ARCHITECTURE.md §2 / this pass's own
   *  Portfolio Intelligence integration. Read-only, summarised, never written to by the assistant. */
  portfolioInsights: Array<{
    insightId: string;
    insightType: string;
    message: string;
    severity: string;
  }>;
  /** getRecentPayments -- confirmed rent payments, most recent first. */
  recentPayments: Array<{ leaseId: string; tenantName: string; amount: number; paidDate: string }>;
  /** getOccupancySummary -- unit counts by status, org-wide. */
  occupancySummary: { occupied: number; vacant: number; maintenance: number; total: number };
}

// Final pre-UAT engineering pass, Part 8's tenant-side tool registry: getTenantBalance,
// getTenantPaymentStatus, getTenantRentSchedule, getTenantLeaseSummary,
// getTenantMaintenanceStatus, getTenantNotices.
export interface AssembledTenantContext {
  kind: 'tenant';
  tenantId: string;
  orgId: string;
  generatedAt: string;
  /** getTenantBalance -- sum of all non-paid rent_schedules amounts for the tenant's active lease(s). */
  outstandingBalance: number;
  /** getTenantPaymentStatus -- the tenant's own payment_reports, most recent first. */
  recentPaymentReports: Array<{
    reportId: string;
    amount: number;
    status: string;
    paymentDate: string;
  }>;
  /** getTenantRentSchedule -- upcoming/unpaid rent_schedules rows for the tenant's active lease. */
  rentSchedule: Array<{ dueDate: string; amount: number; status: string }>;
  /** getTenantLeaseSummary. */
  lease: {
    leaseId: string;
    propertyLabel: string;
    unitLabel: string | null;
    rentAmount: number;
    startDate: string;
    endDate: string | null;
    status: string;
  } | null;
  /** getTenantMaintenanceStatus -- the tenant's own maintenance_tickets. */
  maintenanceTickets: Array<{ ticketId: string; title: string; status: string; priority: string }>;
  /** getTenantNotices -- announcements visible to this tenant (portfolio-wide or their property). */
  notices: Array<{ noticeId: string; title: string; publishedAt: string }>;
}

export type AssembledAssistantContext = AssembledOrgContext | AssembledTenantContext;

export interface ConversationTurn {
  role: AiMessageRole;
  content: string;
}

export interface LLMConverseInput {
  context: AssembledAssistantContext;
  history: ConversationTurn[];
  userMessage: string;
}

export interface LLMConverseResult {
  replyText: string;
  /** Final pre-UAT engineering pass (WORKLOG.md this date): the write-staging capability this
   *  field enables (§1.5-1.7) is explicitly DISABLED for V1 -- MockLLMProvider never populates
   *  this, and POST /api/v1/ai/messages/:id/confirm refuses to act on it even if some future
   *  provider did. The type is kept (not deleted) so a later, deliberately-scoped pass can
   *  re-enable it without a schema/interface change -- see AI_ARCHITECTURE.md's V1 status note. */
  stagedChange?: StagedChange;
  costMetadata?: { inputTokens: number; outputTokens: number; costUsd: number };
}

// AI_ARCHITECTURE.md §3.1 -- vendor undecided (§3, open decision). No vendor-specific type ever
// crosses this boundary.
export interface LLMProvider {
  converse(input: LLMConverseInput): Promise<LLMConverseResult>;
}

// === Portfolio Intelligence (AI_ARCHITECTURE.md §2) -- rules-engine output, never LLM-generated ===

export interface PortfolioInsight {
  id: string;
  orgId: string;
  insightType: PortfolioInsightType;
  message: string;
  dataSource: Record<string, unknown>;
  severity: PortfolioInsightSeverity;
  generatedAt: string;
  dismissedAt: string | null;
}

// === Usage metering (AI_ARCHITECTURE.md §4, DATABASE.md §7) ===

export interface UsageEvent {
  id: string;
  orgId: string;
  usageType: UsageType;
  quantity: number;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  recordedAt: string;
}

export interface UsageSnapshot {
  id: string;
  orgId: string;
  period: string;
  usageType: UsageType;
  totalQuantity: number;
  computedAt: string;
}
