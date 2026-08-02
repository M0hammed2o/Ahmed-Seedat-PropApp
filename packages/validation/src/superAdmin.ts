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

export const billingCancelSchema = z.object({
  providerSubscriptionId: z.string().min(1, 'providerSubscriptionId is required'),
});
export type BillingCancelInput = z.infer<typeof billingCancelSchema>;

export const billingRefundSchema = z.object({
  idempotencyKey: z.string().min(1, 'idempotencyKey is required').max(200),
});
export type BillingRefundInput = z.infer<typeof billingRefundSchema>;
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

export const planCreateSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  billingCycle: z.enum(BILLING_CYCLES),
  basePrice: z.number().nonnegative(),
  currency: z.string().length(3).default('ZAR'),
  featureLimits: z.record(z.string(), z.union([z.number(), z.boolean()])).default({}),
});
export type PlanCreateInput = z.infer<typeof planCreateSchema>;
