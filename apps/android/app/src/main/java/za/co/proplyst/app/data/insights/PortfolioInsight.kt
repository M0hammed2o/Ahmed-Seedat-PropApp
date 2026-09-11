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
    /**
     * The record that triggered this insight, lifted from `data_source.triggering_records[0]`
     * (see apps/admin/lib/portfolioIntelligence.ts, which has written both fields since the rules
     * engine was built). Android used to drop the whole `data_source` object on the floor in
     * WebApiPortfolioInsightsRepository, which is the only reason Needs-attention rows could not
     * open the thing they were complaining about.
     *
     * [entityTable] is the Postgres table name -- 'invoices', 'leases', 'maintenance_tickets',
     * 'rent_schedules', 'property_budgets', 'utility_readings'. Nullable because an insight type
     * added later might not carry one, and a null simply means "no destination", never a crash.
     */
    val entityTable: String? = null,
    val entityId: String? = null,
)

sealed interface PortfolioInsightsResult {
    data class Loaded(val insights: List<PortfolioInsight>) : PortfolioInsightsResult
    data class Error(val message: String) : PortfolioInsightsResult
}

interface PortfolioInsightsRepository {
    suspend fun getPortfolioInsights(orgId: String): PortfolioInsightsResult
}
