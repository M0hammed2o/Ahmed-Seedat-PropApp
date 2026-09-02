package za.co.proplyst.app.data.financials

import za.co.proplyst.app.data.network.WebApi
import za.co.proplyst.app.data.network.dto.FinancialSummaryDto
import za.co.proplyst.app.data.network.dto.TenantPaymentStatusRowDto
import za.co.proplyst.app.data.network.dto.WebApiErrorBody
import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import retrofit2.Response
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WebApiFinancialSummaryRepository @Inject constructor(
    private val webApi: WebApi,
) : FinancialSummaryRepository {

    private val errorJson = Json { ignoreUnknownKeys = true }

    override suspend fun getFinancialSummary(propertyId: String, month: String): FinancialSummaryResult {
        return try {
            val response = webApi.getFinancialSummary(propertyId, month)
            if (!response.isSuccessful) {
                return FinancialSummaryResult.Error(errorMessage(response) ?: "Failed to load the financial summary.")
            }
            val summary = response.body()?.financialSummary
                ?: return FinancialSummaryResult.Error("Failed to load the financial summary.")
            FinancialSummaryResult.Loaded(summary.toDomain())
        } catch (e: Exception) {
            FinancialSummaryResult.Error(e.message ?: "Failed to load the financial summary -- check your connection.")
        }
    }

    override suspend fun getTenantPaymentStatus(propertyId: String, month: String): TenantPaymentStatusResult {
        return try {
            val response = webApi.getTenantPaymentStatus(propertyId, month)
            if (!response.isSuccessful) {
                return TenantPaymentStatusResult.Error(errorMessage(response) ?: "Failed to load rent status.")
            }
            val rows = response.body()?.tenantPaymentStatus.orEmpty().map { it.toDomain() }
            TenantPaymentStatusResult.Loaded(rows)
        } catch (e: Exception) {
            TenantPaymentStatusResult.Error(e.message ?: "Failed to load rent status -- check your connection.")
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

    private fun FinancialSummaryDto.toDomain() = FinancialSummary(
        month = month,
        rentPlanned = rentPlanned,
        rentCollected = rentCollected,
        rentOutstanding = rentOutstanding,
        utilitiesExpense = utilitiesExpense,
        ratesAndLeviesExpense = ratesAndLeviesExpense,
        otherExpenses = otherExpenses,
        totalExpenses = totalExpenses,
        budgetPlanned = budgetPlanned,
        budgetUsedPercent = budgetUsedPercent,
        budgetRemaining = budgetRemaining,
        netOperatingPosition = netOperatingPosition,
        awaitingConfirmationCount = awaitingConfirmationCount,
        budgetAlertLevel = budgetAlerts.firstOrNull()?.level,
    )

    private fun TenantPaymentStatusRowDto.toDomain() = TenantPaymentStatusRow(
        rentScheduleId = rentScheduleId,
        tenantName = tenantName,
        unitLabel = unitLabel,
        expectedRent = expectedRent,
        confirmedPaid = confirmedPaid,
        outstanding = outstanding,
        status = status,
        dueDate = dueDate,
    )
}
