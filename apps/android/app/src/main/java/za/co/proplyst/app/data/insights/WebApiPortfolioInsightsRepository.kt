package za.co.proplyst.app.data.insights

import za.co.proplyst.app.data.network.WebApi
import za.co.proplyst.app.data.network.dto.InsightDto
import za.co.proplyst.app.data.network.dto.WebApiErrorBody
import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import retrofit2.Response
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WebApiPortfolioInsightsRepository @Inject constructor(
    private val webApi: WebApi,
) : PortfolioInsightsRepository {

    private val errorJson = Json { ignoreUnknownKeys = true }

    override suspend fun getPortfolioInsights(orgId: String): PortfolioInsightsResult {
        return try {
            val response = webApi.getPortfolioInsights(orgId)
            if (!response.isSuccessful) {
                return PortfolioInsightsResult.Error(
                    errorMessage(response) ?: "Failed to load portfolio insights.",
                )
            }
            val insights = response.body()?.insights.orEmpty().map { it.toDomain() }
            PortfolioInsightsResult.Loaded(insights)
        } catch (e: Exception) {
            PortfolioInsightsResult.Error(e.message ?: "Failed to load insights -- check your connection.")
        }
    }

    private fun errorMessage(response: Response<*>): String? {
        val raw = response.errorBody()?.string() ?: return null
        return try {
            errorJson.decodeFromString<WebApiErrorBody>(raw).error?.message
        } catch (_: Exception) {
            null
        }
    }

    private fun InsightDto.toDomain(): PortfolioInsight {
        // The rules engine can list several triggering records; the first is the primary one its
        // own reconciliation key is built from (`${insightType}:${primaryRecordId}` in
        // portfolioIntelligence.ts), so it is the right one to open. Blank strings are treated as
        // absent -- a whitespace id would otherwise build a route that 404s on arrival.
        val primary = dataSource?.triggeringRecords?.firstOrNull()
        return PortfolioInsight(
            id = id,
            insightType = insightType,
            message = message,
            severity = severity,
            generatedAt = generatedAt,
            entityTable = primary?.table?.takeIf { it.isNotBlank() },
            entityId = primary?.id?.takeIf { it.isNotBlank() },
        )
    }
}
