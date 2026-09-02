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
    val utilitiesExpense: Double,
    val ratesAndLeviesExpense: Double,
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

interface FinancialSummaryRepository {
    suspend fun getFinancialSummary(propertyId: String, month: String): FinancialSummaryResult
    suspend fun getPortfolioFinancialSummary(orgId: String, month: String): FinancialSummaryResult
    suspend fun getTenantPaymentStatus(propertyId: String, month: String): TenantPaymentStatusResult
}
