package za.co.proplyst.app.data.ownersummary

import za.co.proplyst.app.data.network.PostgrestApi
import za.co.proplyst.app.data.network.dto.OwnerSummaryDto
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PostgrestOwnerSummaryRepository @Inject constructor(
    private val api: PostgrestApi,
) : OwnerSummaryRepository {

    override suspend fun getMySummaries(): OwnerSummaryResult {
        return try {
            val response = api.getMyOwnerSummaries()
            if (!response.isSuccessful) {
                return OwnerSummaryResult.Error("Failed to load your monthly summaries.")
            }
            OwnerSummaryResult.Loaded(response.body().orEmpty().map { it.toDomain() })
        } catch (e: Exception) {
            OwnerSummaryResult.Error(e.message ?: "Failed to load summaries — check your connection.")
        }
    }

    private fun OwnerSummaryDto.toDomain() = OwnerSummary(
        id = id,
        periodStart = periodStart,
        periodEnd = periodEnd,
        propertyCount = propertyCount,
        expectedRent = expectedRent,
        confirmedPaid = confirmedPaid,
        outstanding = outstanding,
        awaitingConfirmation = awaitingConfirmation,
        openMaintenanceCount = openMaintenanceCount,
        upcomingLeaseExpiryCount = upcomingLeaseExpiryCount,
        sentAt = sentAt,
    )
}
