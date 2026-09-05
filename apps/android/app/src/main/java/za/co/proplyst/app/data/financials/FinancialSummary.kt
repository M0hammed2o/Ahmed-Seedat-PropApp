package za.co.proplyst.app.data.financials

/** V1 utilities/rates/levies/budgets pass (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §6/§16).
 * Server-authoritative -- every figure is computed by owner_financial_summary()/budget_vs_actual()
 * (migrations 164/166), never recomputed on-device (§17). */
data class FinancialSummary(
    val month: String,
    /** Non-null only for the portfolio-wide summary -- how many properties contributed. */
    val propertyCount: Int? = null,
    val rentPlanned: Double,
    val rentCollected: Double,
    val rentOutstanding: Double,
    /** water + electricity, kept for backward compatibility -- see the split fields below. */
    val utilitiesExpense: Double,
    val waterExpense: Double = 0.0,
    val electricityExpense: Double = 0.0,
    /** rates & taxes + levies, kept for backward compatibility -- see the split fields below. */
    val ratesAndLeviesExpense: Double,
    val ratesTaxesExpense: Double = 0.0,
    val leviesExpense: Double = 0.0,
    val otherExpenses: Double,
    val totalExpenses: Double,
    val budgetPlanned: Double?,
    val budgetUsedPercent: Double?,
    val budgetRemaining: Double?,
    val netOperatingPosition: Double,
    val awaitingConfirmationCount: Int,
    val budgetAlertLevel: String?,
)

sealed interface FinancialSummaryResult {
    data class Loaded(val summary: FinancialSummary) : FinancialSummaryResult
    data class Error(val message: String) : FinancialSummaryResult
}

/** §6: tenant name/unit/expected/confirmed/outstanding/status/due date, one row per rent_schedule
 * -- reuses rent_schedules.status directly, never inferred from payment_reports. */
data class TenantPaymentStatusRow(
    val rentScheduleId: String,
    val tenantName: String,
    val unitLabel: String,
    val expectedRent: Double,
    val confirmedPaid: Double,
    val outstanding: Double,
    val status: String,
    val dueDate: String,
)

sealed interface TenantPaymentStatusResult {
    data class Loaded(val rows: List<TenantPaymentStatusRow>) : TenantPaymentStatusResult
    data class Error(val message: String) : TenantPaymentStatusResult
}

/** Phase A budget-hierarchy pass (WORKLOG.md this date): one calendar month's planned/actual
 *  budget figures, as part of a full-year batch -- see [AnnualBudget]. */
data class AnnualBudgetMonth(
    val month: String,
    val plannedAmount: Double?,
    val actualAmount: Double,
)

/** `annual` is a pure server-side sum of [months] -- never recomputed on-device, so Portfolio and
 *  Property annual views (and the web equivalents) can never drift from each other. */
data class AnnualBudget(
    val year: Int,
    val monthsPlanned: Int,
    val annualPlanned: Double,
    val annualActual: Double,
    val annualRemaining: Double,
    val annualPercentUsed: Double?,
    val months: List<AnnualBudgetMonth>,
)

sealed interface AnnualBudgetResult {
    data class Loaded(val budget: AnnualBudget) : AnnualBudgetResult
    data class Error(val message: String) : AnnualBudgetResult
}

interface FinancialSummaryRepository {
    suspend fun getFinancialSummary(propertyId: String, month: String): FinancialSummaryResult
    suspend fun getPortfolioFinancialSummary(orgId: String, month: String): FinancialSummaryResult
    suspend fun getTenantPaymentStatus(propertyId: String, month: String): TenantPaymentStatusResult
    suspend fun getPropertyBudgetAnnual(propertyId: String, year: Int): AnnualBudgetResult
    suspend fun getPortfolioBudgetAnnual(orgId: String, year: Int): AnnualBudgetResult
}
