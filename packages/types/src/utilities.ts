// V1 utilities/rates/levies/budgets pass (UTILITIES_RATES_BUDGET_GAP_AUDIT.md,
// UTILITIES_RATES_BUDGET_IMPLEMENTATION.md). Mirrors migrations 20260101000163-165 exactly.

export type RecurringCostType = 'rates_and_taxes' | 'levy';

export interface RecurringPropertyCost {
  id: string;
  orgId: string;
  propertyId: string;
  unitId: string | null;
  costType: RecurringCostType;
  amount: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type UtilityType = 'water' | 'electricity';

export type UtilityResponsibilityMode =
  | 'owner_paid'
  | 'tenant_paid_direct'
  | 'tenant_prepaid'
  | 'included_in_rent'
  | 'common_area_owner';

export interface UtilityResponsibilitySetting {
  id: string;
  orgId: string;
  propertyId: string;
  unitId: string | null;
  utilityType: UtilityType;
  responsibilityMode: UtilityResponsibilityMode;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UtilityMeter {
  id: string;
  orgId: string;
  propertyId: string;
  unitId: string | null;
  utilityType: UtilityType;
  meterNumber: string | null;
  responsibilityMode: UtilityResponsibilityMode;
  isPrepaid: boolean;
  active: boolean;
  installedDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type UtilityReadingSource = 'actual' | 'estimated' | 'manual';

export interface UtilityReading {
  id: string;
  orgId: string;
  meterId: string;
  periodMonth: string;
  readingDate: string;
  readingValue: number;
  consumption: number | null;
  unitOfMeasure: 'L' | 'kWh';
  source: UtilityReadingSource;
  recordedBy: string | null;
  documentId: string | null;
  notes: string | null;
  createdAt: string;
}

/** One point in a utility_readings history series, shaped for a chart/list -- includes the
 * period-over-period % change so the client never recomputes that itself. */
export interface UtilityHistoryPoint {
  periodMonth: string;
  readingValue: number;
  consumption: number | null;
  previousConsumption: number | null;
  percentChange: number | null;
  /** true when |percentChange| exceeds the anomaly threshold AND enough prior history exists --
   * server-computed, per ANOMALY wording rules (never "leak detected", only "unusual usage"). */
  isUnusualUsage: boolean;
}

export interface PropertyBudget {
  id: string;
  orgId: string;
  propertyId: string;
  month: string;
  plannedAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetCategoryLine {
  id: string;
  budgetId: string;
  orgId: string;
  category: string;
  plannedAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetVsActual {
  budgetId: string | null;
  plannedAmount: number | null;
  actualAmount: number;
  remainingAmount: number | null;
  varianceAmount: number | null;
  percentUsed: number | null;
}

export type BudgetAlertLevel = 'approaching' | 'exceeded';

export interface BudgetAlert {
  propertyId: string;
  month: string;
  level: BudgetAlertLevel;
  percentUsed: number;
}

export interface UtilityAnomalyAlert {
  meterId: string;
  propertyId: string;
  unitId: string | null;
  utilityType: UtilityType;
  periodMonth: string;
  percentChange: number;
  message: string;
}

/** The single server-authoritative owner financial summary shape (API_SPEC.md-style one-call
 * contract) -- Android Home and the web Reports page both consume this instead of composing it
 * from several independent queries (§16/§17's explicit "avoid N+1" / "server-authoritative
 * calculations" rules). */
export interface OwnerFinancialSummary {
  propertyId: string | null;
  /** Set only by the portfolio-wide endpoint (GET /api/v1/organizations/:orgId/financial-summary)
   * -- how many properties contributed to this sum. Null/absent on the per-property endpoint. */
  propertyCount?: number;
  month: string;
  rentPlanned: number;
  rentCollected: number;
  rentOutstanding: number;
  utilitiesExpense: number;
  ratesAndLeviesExpense: number;
  otherExpenses: number;
  totalExpenses: number;
  budgetPlanned: number | null;
  budgetUsedPercent: number | null;
  budgetRemaining: number | null;
  netOperatingPosition: number;
  awaitingConfirmationCount: number;
  budgetAlerts: BudgetAlert[];
  utilityAnomalyAlerts: UtilityAnomalyAlert[];
}
