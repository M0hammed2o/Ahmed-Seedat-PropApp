package za.co.proplyst.app.data.network.dto

import kotlinx.serialization.Serializable

/** GET api/v1/properties/{id}/financial-summary?month=... -- V1 utilities/rates/levies pass
 * (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §6/§8/§16). Server-authoritative -- every figure here is
 * computed by owner_financial_summary()/budget_vs_actual() (migrations 164/166), never recomputed
 * on-device. Mirrors the web API's OwnerFinancialSummary shape (packages/types/src/utilities.ts). */
@Serializable
data class FinancialSummaryDto(
    val propertyId: String? = null,
    /** Set only by the portfolio-wide endpoint. */
    val propertyCount: Int? = null,
    val month: String,
    val rentPlanned: Double,
    val rentCollected: Double,
    val rentOutstanding: Double,
    val utilitiesExpense: Double,
    val ratesAndLeviesExpense: Double,
    val otherExpenses: Double,
    val totalExpenses: Double,
    val budgetPlanned: Double? = null,
    val budgetUsedPercent: Double? = null,
    val budgetRemaining: Double? = null,
    val netOperatingPosition: Double,
    val awaitingConfirmationCount: Int,
    val budgetAlerts: List<BudgetAlertDto> = emptyList(),
)

@Serializable
data class BudgetAlertDto(
    val propertyId: String,
    val month: String,
    val level: String,
    val percentUsed: Double,
)

@Serializable
data class FinancialSummaryResponse(val financialSummary: FinancialSummaryDto)

/** GET api/v1/properties/{id}/tenant-payment-status?month=... -- reuses rent_schedules directly
 * (never payment_reports, never a duplicate status table -- see the route's own doc comment). */
@Serializable
data class TenantPaymentStatusRowDto(
    val rentScheduleId: String,
    val tenantName: String,
    val unitLabel: String,
    val expectedRent: Double,
    val confirmedPaid: Double,
    val outstanding: Double,
    val status: String,
    val dueDate: String,
)

@Serializable
data class TenantPaymentStatusResponse(val tenantPaymentStatus: List<TenantPaymentStatusRowDto>)

/** GET/POST api/v1/properties/{id}/utility-meters, GET/POST api/v1/utility-meters/{id}/readings. */
@Serializable
data class UtilityMeterDto(
    val id: String,
    val orgId: String,
    val propertyId: String,
    val unitId: String? = null,
    val utilityType: String,
    val meterNumber: String? = null,
    val responsibilityMode: String,
    val isPrepaid: Boolean,
    val active: Boolean,
)

@Serializable
data class UtilityMeterListResponse(val utilityMeters: List<UtilityMeterDto>)

@Serializable
data class UtilityMeterCreateRequest(
    val orgId: String,
    val utilityType: String,
    val meterNumber: String? = null,
    val responsibilityMode: String,
    val isPrepaid: Boolean = false,
)

@Serializable
data class UtilityMeterCreateResponse(val utilityMeter: UtilityMeterDto)

@Serializable
data class UtilityReadingCreateRequest(
    val periodMonth: String,
    val readingDate: String,
    val readingValue: Double,
    val unitOfMeasure: String,
    val source: String = "manual",
    val documentId: String? = null,
    val notes: String? = null,
    val replaceExisting: Boolean = false,
)

@Serializable
data class UtilityHistoryPointDto(
    val periodMonth: String,
    val readingValue: Double,
    val consumption: Double? = null,
    val previousConsumption: Double? = null,
    val percentChange: Double? = null,
    val isUnusualUsage: Boolean = false,
)

@Serializable
data class UtilityHistoryResponse(val history: List<UtilityHistoryPointDto>)
