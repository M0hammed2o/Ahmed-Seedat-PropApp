package za.co.proplyst.app.data.insights

import kotlinx.coroutines.delay
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MockPortfolioInsightsRepository @Inject constructor() : PortfolioInsightsRepository {

    private val insights = listOf(
        PortfolioInsight(
            id = "demo-insight-1",
            insightType = "rent_overdue",
            message = "Rent of 12500 is 5 days overdue (due 2026-08-13).",
            severity = "warning",
            generatedAt = "2026-08-18T06:00:00Z",
        ),
    )

    override suspend fun getPortfolioInsights(orgId: String): PortfolioInsightsResult {
        delay(300)
        return PortfolioInsightsResult.Loaded(insights)
    }
}
