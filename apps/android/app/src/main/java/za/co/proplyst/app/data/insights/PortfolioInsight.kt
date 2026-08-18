package za.co.proplyst.app.data.insights

/** Final pre-UAT engineering pass (WORKLOG.md this date), Part 5 -- Android's own view of the
 * same deterministic rules-engine feed the web dashboard's PortfolioInsightsPanel.tsx shows
 * (AI_ARCHITECTURE.md §2, never an LLM). Owner/staff-only. */
data class PortfolioInsight(
    val id: String,
    val insightType: String,
    val message: String,
    val severity: String,
    val generatedAt: String,
)

sealed interface PortfolioInsightsResult {
    data class Loaded(val insights: List<PortfolioInsight>) : PortfolioInsightsResult
    data class Error(val message: String) : PortfolioInsightsResult
}

interface PortfolioInsightsRepository {
    suspend fun getPortfolioInsights(orgId: String): PortfolioInsightsResult
}
