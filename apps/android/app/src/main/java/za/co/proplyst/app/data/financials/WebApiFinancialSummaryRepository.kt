package za.co.proplyst.app.data.financials

import za.co.proplyst.app.data.network.WebApi
import za.co.proplyst.app.data.network.dto.AnnualBudgetMonthDto
import za.co.proplyst.app.data.network.dto.AnnualBudgetResponse
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

    override suspend fun getPortfolioFinancialSummary(orgId: String, month: String): FinancialSummaryResult {
        return try {
            val response = webApi.getPortfolioFinancialSummary(orgId, month)
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

    override suspend fun getPropertyBudgetAnnual(propertyId: String, year: Int): AnnualBudgetResult {
        return try {
            val response = webApi.getPropertyBudgetAnnual(propertyId, year)
            if (!response.isSuccessful) {
                return AnnualBudgetResult.Error(errorMessage(response) ?: "Failed to load the annual budget.")
            }
            val body = response.body() ?: return AnnualBudgetResult.Error("Failed to load the annual budget.")
            AnnualBudgetResult.Loaded(body.toDomain())
        } catch (e: Exception) {
            AnnualBudgetResult.Error(e.message ?: "Failed to load the annual budget -- check your connection.")
        }
    }

    override suspend fun getPortfolioBudgetAnnual(orgId: String, year: Int): AnnualBudgetResult {
        return try {
            val response = webApi.getPortfolioBudgetAnnual(orgId, year)
            if (!response.isSuccessful) {
                return AnnualBudgetResult.Error(errorMessage(response) ?: "Failed to load the annual budget.")
            }
            val body = response.body() ?: return AnnualBudgetResult.Error("Failed to load the annual budget.")
            AnnualBudgetResult.Loaded(body.toDomain())
        } catch (e: Exception) {
            AnnualBudgetResult.Error(e.message ?: "Failed to load the annual budget -- check your connection.")
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
        propertyCount = propertyCount,
        rentPlanned = rentPlanned,
        rentCollected = rentCollected,
        rentOutstanding = rentOutstanding,
        utilitiesExpense = utilitiesExpense,
        waterExpense = waterExpense,
        electricityExpense = electricityExpense,
        ratesAndLeviesExpense = ratesAndLeviesExpense,
        ratesTaxesExpense = ratesTaxesExpense,
        leviesExpense = leviesExpense,
        otherExpenses = otherExpenses,
        totalExpenses = totalExpenses,
        budgetPlanned = budgetPlanned,
        budgetUsedPercent = budgetUsedPercent,
        budgetRemaining = budgetRemaining,
        netOperatingPosition = netOperatingPosition,
        awaitingConfirmationCount = awaitingConfirmationCount,
        budgetAlertLevel = budgetAlerts.firstOrNull()?.level,
    )

    private fun AnnualBudgetResponse.toDomain() = AnnualBudget(
        year = annual.year,
        monthsPlanned = annual.monthsPlanned,
        annualPlanned = annual.annualPlanned,
        annualActual = annual.annualActual,
        annualRemaining = annual.annualRemaining,
        annualPercentUsed = annual.annualPercentUsed,
        months = months.map { it.toDomain() },
    )

    private fun AnnualBudgetMonthDto.toDomain() = AnnualBudgetMonth(
        month = month,
        plannedAmount = plannedAmount,
        actualAmount = actualAmount,
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
