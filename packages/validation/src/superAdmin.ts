import { z } from 'zod';
import { BILLING_CYCLES } from '@propvault/types';

// Super Admin API (apps/admin/app/api/v1/admin/** -- API_SPEC.md §2, TASKS.md M19).

export const organizationPlanUpdateSchema = z.object({
  planId: z.string().uuid('planId must be a valid UUID').optional(),
  priceOverride: z.number().nonnegative().nullable().optional(),
  discountPct: z.number().min(0).max(100).nullable().optional(),
});

// Organization-level SaaS billing (SUBSCRIPTIONS.md, apps/admin/lib/billing.ts).
export const billingCheckoutSchema = z.object({
  planId: z.string().uuid('planId must be a valid UUID'),
  idempotencyKey: z.string().min(1, 'idempotencyKey is required').max(200),
});
export type BillingCheckoutInput = z.infer<typeof billingCheckoutSchema>;

export const billingRefundSchema = z.object({
  idempotencyKey: z.string().min(1, 'idempotencyKey is required').max(200),
});
export type BillingRefundInput = z.infer<typeof billingRefundSchema>;

// RELEASE A: provider-independent billing-change engine (SUBSCRIPTIONS.md, migration
// 20260101000104, apps/admin/lib/billing.ts).
export const billingPlanChangeQuoteSchema = z.object({
  targetPlanId: z.string().uuid('targetPlanId must be a valid UUID'),
});
export type BillingPlanChangeQuoteInput = z.infer<typeof billingPlanChangeQuoteSchema>;

export const billingPlanChangeConfirmSchema = z.object({
  quoteId: z.string().uuid('quoteId must be a valid UUID'),
  idempotencyKey: z.string().min(1, 'idempotencyKey is required').max(200),
});
export type BillingPlanChangeConfirmInput = z.infer<typeof billingPlanChangeConfirmSchema>;
export type OrganizationPlanUpdateInput = z.infer<typeof organizationPlanUpdateSchema>;

export const creditIssueSchema = z.object({
  amount: z.number().positive('amount must be greater than 0'),
  reason: z.string().min(1, 'reason is required').max(500),
});
export type CreditIssueInput = z.infer<typeof creditIssueSchema>;

// support_access_sessions.reason has a DB-level `char_length(reason) >= 10` check
// (SUPER_ADMIN.md §6) -- mirrored here so a caller gets a clean 400 with field_errors instead of
// a raw Postgres constraint-violation message.
export const supportSessionCreateSchema = z.object({
  orgId: z.string().uuid('orgId must be a valid UUID'),
  reason: z.string().min(10, 'reason must be at least 10 characters').max(1000),
});
export type SupportSessionCreateInput = z.infer<typeof supportSessionCreateSchema>;

// Owner subscription + staff seat entitlement architecture (WORKLOG.md this date) -- the manual
// lever unlocking create_organization() for a "linked owner only" account until a real payment
// provider populates owner_portfolio_grants the same way.
export const ownerPortfolioGrantCreateSchema = z.object({
  userId: z.string().uuid('userId must be a valid UUID'),
  note: z.string().max(500).optional(),
});
export type OwnerPortfolioGrantCreateInput = z.infer<typeof ownerPortfolioGrantCreateSchema>;

export const planCreateSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  billingCycle: z.enum(BILLING_CYCLES),
  basePrice: z.number().nonnegative(),
  currency: z.string().length(3).default('ZAR'),
  featureLimits: z.record(z.string(), z.union([z.number(), z.boolean()])).default({}),
});
export type PlanCreateInput = z.infer<typeof planCreateSchema>;
