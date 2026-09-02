import { z } from 'zod';

// V1 utilities/rates/levies/budgets pass (UTILITIES_RATES_BUDGET_GAP_AUDIT.md). Mirrors
// migrations 20260101000163-165's RPC parameter shapes -- these schemas validate the request body
// each thin API route wrapper passes straight through to the corresponding RPC.

export const recurringCostSetSchema = z.object({
  orgId: z.string().uuid(),
  propertyId: z.string().uuid(),
  unitId: z.string().uuid().optional().nullable(),
  costType: z.enum(['rates_and_taxes', 'levy']),
  // null retires the cost (§1B: "never force a bogus zero/placeholder amount") -- omit entirely to
  // leave a required-amount validation error instead of silently retiring.
  amount: z.number().min(0).nullable(),
  effectiveFrom: z.string().min(1, 'effectiveFrom must be YYYY-MM-DD'),
  notes: z.string().max(500).optional().nullable(),
});
export type RecurringCostSetInput = z.infer<typeof recurringCostSetSchema>;

export const utilityResponsibilitySetSchema = z.object({
  orgId: z.string().uuid(),
  propertyId: z.string().uuid(),
  unitId: z.string().uuid().optional().nullable(),
  utilityType: z.enum(['water', 'electricity']),
  responsibilityMode: z.enum([
    'owner_paid',
    'tenant_paid_direct',
    'tenant_prepaid',
    'included_in_rent',
    'common_area_owner',
  ]),
  notes: z.string().max(500).optional().nullable(),
});
export type UtilityResponsibilitySetInput = z.infer<typeof utilityResponsibilitySetSchema>;

export const utilityMeterCreateSchema = z.object({
  orgId: z.string().uuid(),
  propertyId: z.string().uuid(),
  unitId: z.string().uuid().optional().nullable(),
  utilityType: z.enum(['water', 'electricity']),
  meterNumber: z.string().max(100).optional().nullable(),
  responsibilityMode: z.enum([
    'owner_paid',
    'tenant_paid_direct',
    'tenant_prepaid',
    'included_in_rent',
    'common_area_owner',
  ]),
  isPrepaid: z.boolean().default(false),
  installedDate: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});
export type UtilityMeterCreateInput = z.infer<typeof utilityMeterCreateSchema>;

export const utilityReadingCreateSchema = z.object({
  periodMonth: z.string().min(1, 'periodMonth must be YYYY-MM-DD (first of month)'),
  readingDate: z.string().min(1, 'readingDate must be YYYY-MM-DD'),
  readingValue: z.number().min(0),
  unitOfMeasure: z.enum(['L', 'kWh']),
  source: z.enum(['actual', 'estimated', 'manual']).default('manual'),
  documentId: z.string().uuid().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  replaceExisting: z.boolean().default(false),
});
export type UtilityReadingCreateInput = z.infer<typeof utilityReadingCreateSchema>;

export const monthlyBudgetSetSchema = z.object({
  orgId: z.string().uuid(),
  propertyId: z.string().uuid(),
  month: z.string().min(1, 'month must be YYYY-MM-01'),
  plannedAmount: z.number().min(0),
});
export type MonthlyBudgetSetInput = z.infer<typeof monthlyBudgetSetSchema>;

export const annualBudgetDistributeSchema = z.object({
  orgId: z.string().uuid(),
  propertyId: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  annualTotal: z.number().min(0),
});
export type AnnualBudgetDistributeInput = z.infer<typeof annualBudgetDistributeSchema>;

export const budgetCategoryLineSetSchema = z.object({
  budgetId: z.string().uuid(),
  orgId: z.string().uuid(),
  category: z.string().min(1).max(100),
  plannedAmount: z.number().min(0),
});
export type BudgetCategoryLineSetInput = z.infer<typeof budgetCategoryLineSetSchema>;
