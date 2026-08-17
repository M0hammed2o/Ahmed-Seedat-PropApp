package za.co.proplyst.app.data.ownersummary

/** Mirrors the web app's owner_property_summaries row (lib/ownerSummary.ts's own
 * OwnerMonthlySummaryRow) -- Android V1 final gap-closure pass (WORKLOG.md this date), Phase 8.
 * Never recalculated here: `expectedRent`/`confirmedPaid`/`outstanding`/`awaitingConfirmation`
 * are read exactly as the server-side aggregation (`runOwnerMonthlySummaryJob()`) computed and
 * stored them once, matching that pass's own "immutable snapshot" design. */
data class OwnerSummary(
    val id: String,
    val periodStart: String,
    val periodEnd: String,
    val propertyCount: Int,
    val expectedRent: Double,
    val confirmedPaid: Double,
    val outstanding: Double,
    val awaitingConfirmation: Double,
    val openMaintenanceCount: Int,
    val upcomingLeaseExpiryCount: Int,
    val sentAt: String?,
)

sealed interface OwnerSummaryResult {
    data class Loaded(val summaries: List<OwnerSummary>) : OwnerSummaryResult
    data class Error(val message: String) : OwnerSummaryResult
}

/** One real implementation (PostgrestOwnerSummaryRepository) and one mock, never mixed -- same
 * split every other repository in this app already uses. */
interface OwnerSummaryRepository {
    suspend fun getMySummaries(): OwnerSummaryResult
}
