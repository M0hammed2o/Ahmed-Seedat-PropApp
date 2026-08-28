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

// Commercial plan restructure -- trial-activation checkout (POST
// /api/v1/organizations/:orgId/billing/trial-activation). Deliberately NOT planId/amount: the
// client selects a tier + interval only, the server resolves the exact active plan row and its
// price itself (never trusts a client-supplied plan id or price) -- see
// startTrialActivationCheckout() in apps/admin/lib/billing.ts.
export const trialActivationCheckoutSchema = z.object({
  planTier: z.enum(['starter', 'professional', 'business']),
  interval: z.enum(['monthly', 'annual']),
  idempotencyKey: z.string().min(1, 'idempotencyKey is required').max(200),
});
export type TrialActivationCheckoutInput = z.infer<typeof trialActivationCheckoutSchema>;

// V1 commercial onboarding pass, Phase 18 -- payment-method-update checkout (POST
// /api/v1/organizations/:orgId/billing/payment-method). No plan/amount input at all: the org's
// CURRENT plan and next_payment_date are resolved server-side (see
// startPaymentMethodUpdateCheckout()) -- this is a card replacement, never a plan change.
// idempotencyKey is client-supplied (not server-generated per request), matching
// trialActivationCheckoutSchema/billingCheckoutSchema's own pattern: a browser retry of the SAME
// user action must reuse the SAME PayFast m_payment_id, or a network-level retry would mint a
// second live gateway subscription before the first ITN ever lands.
export const paymentMethodUpdateCheckoutSchema = z.object({
  idempotencyKey: z.string().min(1, 'idempotencyKey is required').max(200),
});
export type PaymentMethodUpdateCheckoutInput = z.infer<typeof paymentMethodUpdateCheckoutSchema>;

// RELEASE A: provider-independent billing-change engine (SUBSCRIPTIONS.md, migration
// 20260101000104, apps/admin/lib/billing.ts).
export const billingPlanChangeQuoteSchema = z.object({
  targetPlanId: z.string().uuid('targetPlanId must be a valid UUID'),
});
export type BillingPlanChangeQuoteInput = z.infer<typeof billingPlanChangeQuoteSchema>;

// V1 commercial UX pass: the three keep-list arrays are the customer's OPTIONAL explicit choice of
// which resources stay active if this change is a downgrade that puts the org over its new plan's
// allowance -- see confirm_plan_change()'s own extended comment (migration 20260101000121). Omitted
// (or explicitly null) falls back to the deterministic default. Never validated against the actual
// allowance/ownership here -- confirm_plan_change() itself (SECURITY DEFINER, org-scoped) is the
// real authority, and reconcile_plan_limits() defensively caps an oversized selection anyway.
const keepListSchema = z.array(z.string().uuid()).nullish();
export const billingPlanChangeConfirmSchema = z.object({
  quoteId: z.string().uuid('quoteId must be a valid UUID'),
  idempotencyKey: z.string().min(1, 'idempotencyKey is required').max(200),
  keepPropertyIds: keepListSchema,
  keepOwnerIds: keepListSchema,
  keepStaffMemberIds: keepListSchema,
});
export type BillingPlanChangeConfirmInput = z.infer<typeof billingPlanChangeConfirmSchema>;

export const scheduledDowngradeSelectionSchema = z.object({
  keepPropertyIds: keepListSchema,
  keepOwnerIds: keepListSchema,
  keepStaffMemberIds: keepListSchema,
});
export type ScheduledDowngradeSelectionInput = z.infer<typeof scheduledDowngradeSelectionSchema>;

// V1 commercial UX pass -- add-on purchasing (POST /api/v1/organizations/:orgId/billing/addons).
// Deliberately NOT unitPrice/amount: the server derives both from the org's current plan
// (lib/addons.ts) -- never trusts a client-supplied price or resulting total.
export const addonCapacityChangeSchema = z.object({
  resourceType: z.enum(['property', 'owner']),
  targetQuantity: z.number().int().min(0).max(1000),
  keepIds: z.array(z.string().uuid()).nullish(),
  idempotencyKey: z.string().min(1, 'idempotencyKey is required').max(200),
});
export type AddonCapacityChangeInput = z.infer<typeof addonCapacityChangeSchema>;
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

// Referral attribution (V1 launch-completion pass) -- Platform Admin partner management +
// correction routes (apps/admin/app/api/v1/admin/referral-partners/**,
// apps/admin/app/api/v1/admin/referral-attributions/**). Deliberately no commission/payout/rate
// fields anywhere here -- that's explicit V1.1 scope.
export const referralPartnerCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  referralCode: z.string().min(1, 'Referral code is required').max(60),
});
export type ReferralPartnerCreateInput = z.infer<typeof referralPartnerCreateSchema>;

export const referralPartnerUpdateSchema = z.object({
  active: z.boolean(),
});
export type ReferralPartnerUpdateInput = z.infer<typeof referralPartnerUpdateSchema>;

// PATCH /api/v1/admin/referral-attributions/:orgId -- the only sanctioned way to change an
// organization's attribution after signup. Both fields optional/nullable independently: a
// correction may set a resolved partner, clear it back to null, set/replace the fallback name, or
// clear it -- whatever combination the admin actually intends is exactly what's written.
export const referralAttributionCorrectionSchema = z.object({
  referralPartnerId: z.string().uuid('referralPartnerId must be a valid UUID').nullable().optional(),
  fallbackReferrerName: z.string().max(200).nullable().optional(),
});
export type ReferralAttributionCorrectionInput = z.infer<typeof referralAttributionCorrectionSchema>;

export const planCreateSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  billingCycle: z.enum(BILLING_CYCLES),
  basePrice: z.number().nonnegative(),
  currency: z.string().length(3).default('ZAR'),
  featureLimits: z.record(z.string(), z.union([z.number(), z.boolean()])).default({}),
});
export type PlanCreateInput = z.infer<typeof planCreateSchema>;
