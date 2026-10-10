package za.co.proplyst.app.data.utilitystatements

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import retrofit2.Response
import za.co.proplyst.app.data.network.WebApi
import za.co.proplyst.app.data.network.dto.UtilityStatementDto
import za.co.proplyst.app.data.network.dto.WebApiErrorBody
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WebApiUtilityStatementsRepository @Inject constructor(
    private val webApi: WebApi,
) : UtilityStatementsRepository {

    private val errorJson = Json { ignoreUnknownKeys = true }

    override suspend fun getMyStatements(): UtilityStatementsResult {
        return try {
            val response = webApi.getMyUtilityStatements()
            if (!response.isSuccessful) {
                return UtilityStatementsResult.Error(errorMessage(response) ?: "Failed to load utility statements.")
            }
            UtilityStatementsResult.Loaded(response.body()?.statements.orEmpty().map { it.toDomain() })
        } catch (e: Exception) {
            UtilityStatementsResult.Error(e.message ?: "Failed to load utility statements — check your connection.")
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

    private fun UtilityStatementDto.toDomain() = UtilityStatement(
        id = id,
        propertyName = propertyName,
        unitLabel = unitLabel,
        periodStart = periodStart,
        periodEnd = periodEnd,
        total = total,
        vat = vat,
        lines = lines.map {
            UtilityStatementLine(
                utility = it.utility,
                description = it.description,
                segment = it.segment,
                opening = it.opening,
                closing = it.closing,
                consumption = it.consumption,
                unit = it.unit,
                isEstimated = it.basis != "actual",
                tariff = it.tariff,
                total = it.total,
                creditApplied = it.creditApplied,
            )
        },
        notes = notes,
    )
}
