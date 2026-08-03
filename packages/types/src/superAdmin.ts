import type { BillingCycle, OrganizationStatus, OrganizationType } from './enums';
import type { AuditEvent } from './admin';

// Super Admin domain types (SUPER_ADMIN.md, TASKS.md M19). Distinct from the client-org-facing
// Organization type (organization.ts) -- these shapes are what the platform-admin-only
// /api/v1/admin/** endpoints return, always assembled server-side via the service-role client
// after a passing requireRole() check (never derived from a client org role).

export interface SubscriptionPayment {
  id: string;
  orgId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  paymentMethod: string | null;
  providerReference: string | null;
  paidAt: string | null;
  createdAt: string;
}

// SUPER_ADMIN.md §3's client-directory row shape -- one row per organization, counts/plan/
// subscription pre-joined so the directory table never needs a client-side N+1.
export interface PlatformOrganizationSummary {
  orgId: string;
  legalName: string;
  tradingName: string | null;
  orgType: OrganizationType;
  status: OrganizationStatus;
  createdAt: string;
  planCode: string | null;
  planName: string | null;
  billingCycle: BillingCycle | null;
  effectivePrice: number | null; // priceOverride if set, else the plan's basePrice
  discountPct: number | null;
  promotionalCredit: number | null;
  subscriptionStatus: OrganizationStatus | null;
  currentPeriodEnd: string | null;
  nextPaymentDate: string | null;
  propertiesCount: number;
  unitsCount: number;
  ownersCount: number;
  tenantsCount: number;
  staffCount: number;
}

export interface PlatformOrganizationDetail extends PlatformOrganizationSummary {
  usage: Array<{ usageType: string; period: string; totalQuantity: number }>;
  /** Real-time current-calendar-month totals summed directly from `usage_events`
   *  (PWA_V1_COMPLETION_PLAN.md #13) -- `usage` above reads `usage_snapshots`, which stays empty
   *  until the scheduled rollup job (TECHNICAL_DEBT_REGISTER.md TD-20) exists. */
  currentPeriodUsage: { periodStart: string; totals: Record<string, number> };
  recentPayments: SubscriptionPayment[];
  /** Most recent audit_events rows for this org (PWA_V1_COMPLETION_PLAN.md #14). */
  recentAuditEvents: AuditEvent[];
}

export interface SupportAccessSession {
  id: string;
  platformAdminId: string;
  orgId: string;
  reason: string;
  startedAt: string;
  endedAt: string | null;
  actionsTaken: Array<{ action: string; entityType: string; entityId: string; timestamp: string }>;
}

// Platform-wide dashboard metrics (SUPER_ADMIN.md §2.1) -- computed live, not read from a
// materialized snapshot (see DECISIONS.md/TECHNICAL_DEBT_REGISTER.md TD-24 for why: no scheduled-
// function infrastructure exists yet to keep a snapshot fresh, and a live aggregate is not
// actually costly at today's org counts). Churn rate is deliberately excluded -- SUPER_ADMIN.md
// §7.2 flags it as needing a dedicated helper view, not computed here.
export interface PlatformDashboardMetrics {
  totalOrganizations: number;
  organizationsByStatus: Record<OrganizationStatus, number>;
  newOrganizationsThisMonth: number;
  mrr: number;
  arr: number;
  revenueThisMonth: number;
  outstandingRevenue: number;
  failedPaymentsCount: number;
  totalCreditsIssued: number;
  averageRevenuePerClient: number;
  totalProperties: number;
  totalUnits: number;
  totalOwners: number;
  totalTenants: number;
  totalActiveStaff: number;
  computedAt: string;
}
