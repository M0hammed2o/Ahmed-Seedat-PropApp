package za.co.proplyst.app.data.ownersummary

import kotlinx.coroutines.delay
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MockOwnerSummaryRepository @Inject constructor() : OwnerSummaryRepository {

    override suspend fun getMySummaries(): OwnerSummaryResult {
        delay(300)
        return OwnerSummaryResult.Loaded(
            listOf(
                OwnerSummary(
                    id = "demo-summary-1",
                    periodStart = "2026-08-01",
                    periodEnd = "2026-08-31",
                    propertyCount = 2,
                    expectedRent = 21300.0,
                    confirmedPaid = 18000.0,
                    outstanding = 3300.0,
                    awaitingConfirmation = 1200.0,
                    openMaintenanceCount = 1,
                    upcomingLeaseExpiryCount = 0,
                    sentAt = "2026-08-01T08:00:00Z",
                ),
            ),
        )
    }
}
