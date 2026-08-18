package za.co.proplyst.app.data.network.dto

import kotlinx.serialization.Serializable

/** GET api/v1/insights?filter[org_id]=... (final pre-UAT engineering pass, WORKLOG.md this date,
 * Part 5) -- the web API's own mapPortfolioInsightRow() shape (camelCase). RLS
 * (`portfolio_insights_select_org`) is the real scope; filter[org_id] is required by the route
 * itself (unlike most "my own" endpoints this app calls, which send no org filter at all) since
 * portfolio_insights has no tenant-self access path -- this is an owner/staff-only feed. */
@Serializable
data class InsightDto(
    val id: String,
    val orgId: String,
    val insightType: String,
    val message: String,
    val severity: String,
    val generatedAt: String,
    val dismissedAt: String? = null,
)

@Serializable
data class InsightListResponse(val insights: List<InsightDto>)
