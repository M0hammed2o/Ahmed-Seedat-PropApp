package za.co.proplyst.app.data.network.dto

import kotlinx.serialization.SerialName
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
    /** `data_source` jsonb. The API maps the ROW to camelCase (`dataSource`), but the jsonb's own
     * keys stay exactly as the rules engine wrote them -- snake_case -- hence the @SerialName on
     * the inner field but not on this one. Optional throughout: an insight whose data_source is
     * shaped differently must degrade to "not tappable", never to a parse failure that blanks the
     * entire Needs-attention feed. */
    val dataSource: InsightDataSourceDto? = null,
)

@Serializable
data class InsightDataSourceDto(
    @SerialName("triggering_records") val triggeringRecords: List<TriggeringRecordDto> = emptyList(),
)

@Serializable
data class TriggeringRecordDto(
    val table: String? = null,
    val id: String? = null,
)

@Serializable
data class InsightListResponse(val insights: List<InsightDto>)
