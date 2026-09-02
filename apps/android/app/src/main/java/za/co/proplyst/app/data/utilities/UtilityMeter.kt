package za.co.proplyst.app.data.utilities

/** Owner Utility Capture / Utility History (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §6/§7). Mirrors
 * migration 20260101000163's utility_meters/utility_readings shape. */
data class UtilityMeter(
    val id: String,
    val propertyId: String,
    val unitId: String?,
    val utilityType: String, // "water" | "electricity"
    val meterNumber: String?,
    val responsibilityMode: String,
    val isPrepaid: Boolean,
    val active: Boolean,
)

data class UtilityHistoryPoint(
    val periodMonth: String,
    val readingValue: Double,
    val consumption: Double?,
    val previousConsumption: Double?,
    val percentChange: Double?,
    val isUnusualUsage: Boolean,
)

sealed interface UtilityMetersResult {
    data class Loaded(val meters: List<UtilityMeter>) : UtilityMetersResult
    data class Error(val message: String) : UtilityMetersResult
}

sealed interface UtilityHistoryResult {
    data class Loaded(val history: List<UtilityHistoryPoint>) : UtilityHistoryResult
    data class Error(val message: String) : UtilityHistoryResult
}

sealed interface UtilityReadingSubmitResult {
    data object Success : UtilityReadingSubmitResult
    data class Error(val message: String) : UtilityReadingSubmitResult
}

interface UtilitiesRepository {
    suspend fun getMeters(propertyId: String, unitId: String?): UtilityMetersResult
    suspend fun getReadingHistory(meterId: String): UtilityHistoryResult

    /** [evidenceUri], when set, is uploaded (documentType='bill', category matching
     * [utilityType]) and linked as the reading's evidence -- §6's "optional utility bill/receipt
     * upload" requirement, reusing the same secure document-upload path as everything else. This
     * never creates an expense by itself (§6: "the monetary cost must ultimately be represented
     * by the existing expense system... do not create a competing utility expense amount") -- an
     * owner-paid bill still needs its own Add Expense entry, deliberately not auto-generated here
     * since only the owner knows the real amount from the bill (this reading records consumption,
     * not cost). */
    suspend fun recordReading(
        orgId: String,
        propertyId: String,
        meterId: String,
        utilityType: String,
        periodMonth: String,
        readingDate: String,
        readingValue: Double,
        unitOfMeasure: String,
        evidenceUri: android.net.Uri?,
        notes: String?,
    ): UtilityReadingSubmitResult
}
