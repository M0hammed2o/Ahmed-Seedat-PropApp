import type { AiMessageRole, PortfolioInsightSeverity, PortfolioInsightType, UsageType } from './enums';
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
export interface AssembledOrgContext {
  orgId: string;
  generatedAt: string;
  rentOverdue: Array<{ leaseId: string; tenantName: string; amount: number; daysOverdue: number }>;
  rentDueSoon: Array<{ leaseId: string; tenantName: string; amount: number; dueDate: string }>;
  recentExpenses: Array<{ expenseId: string; category: string; amount: number; recordedAt: string }>;
  openMaintenanceTickets: Array<{ ticketId: string; title: string; priority: string; status: string }>;
  leasesExpiringSoon: Array<{ leaseId: string; tenantName: string; endDate: string }>;
}

export interface ConversationTurn {
  role: AiMessageRole;
  content: string;
}

export interface LLMConverseInput {
  context: AssembledOrgContext;
  history: ConversationTurn[];
  userMessage: string;
}

export interface LLMConverseResult {
  replyText: string;
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
