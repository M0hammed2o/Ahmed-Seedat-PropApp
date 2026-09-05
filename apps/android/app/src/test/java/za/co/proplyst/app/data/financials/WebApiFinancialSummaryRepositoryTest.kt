package za.co.proplyst.app.data.financials

import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import retrofit2.Response
import za.co.proplyst.app.data.network.WebApi
import za.co.proplyst.app.data.network.dto.AnnualBudgetMonthDto
import za.co.proplyst.app.data.network.dto.AnnualBudgetResponse
import za.co.proplyst.app.data.network.dto.AnnualBudgetSummaryDto
import za.co.proplyst.app.data.network.dto.FinancialSummaryDto
import za.co.proplyst.app.data.network.dto.FinancialSummaryResponse

/**
 * Phase A budget-hierarchy pass (WORKLOG.md this date): API-parity test. The web API added
 * waterExpense/electricityExpense/ratesTaxesExpense/leviesExpense split fields alongside the
 * pre-existing combined ones -- this proves every one of those fields (split AND combined) survives
 * DTO -> domain mapping unchanged, so a future field-name typo here fails a test instead of silently
 * showing 0.0 on Home/Budget/Property Detail.
 */
class WebApiFinancialSummaryRepositoryTest {

    private fun sampleDto() = FinancialSummaryDto(
        propertyId = "property-1",
        month = "2026-09-01",
        rentPlanned = 12500.0,
        rentCollected = 11000.0,
        rentOutstanding = 1500.0,
        utilitiesExpense = 2400.0,
        waterExpense = 1400.0,
        electricityExpense = 1000.0,
        ratesAndLeviesExpense = 3700.0,
        ratesTaxesExpense = 2450.0,
        leviesExpense = 1250.0,
        otherExpenses = 900.0,
        totalExpenses = 7000.0,
        budgetPlanned = 25000.0,
        budgetUsedPercent = 28.0,
        budgetRemaining = 18000.0,
        netOperatingPosition = 4000.0,
        awaitingConfirmationCount = 2,
    )

    @Test
    fun `every split and combined expense field survives DTO to domain mapping unchanged`() = runTest {
        val webApi = mockk<WebApi>()
        coEvery { webApi.getFinancialSummary("property-1", "2026-09-01") } returns
            Response.success(FinancialSummaryResponse(sampleDto()))
        val repository = WebApiFinancialSummaryRepository(webApi)

        val result = repository.getFinancialSummary("property-1", "2026-09-01")

        require(result is FinancialSummaryResult.Loaded)
        val summary = result.summary
        assertEquals(2400.0, summary.utilitiesExpense, 0.0)
        assertEquals(1400.0, summary.waterExpense, 0.0)
        assertEquals(1000.0, summary.electricityExpense, 0.0)
        assertEquals(3700.0, summary.ratesAndLeviesExpense, 0.0)
        assertEquals(2450.0, summary.ratesTaxesExpense, 0.0)
        assertEquals(1250.0, summary.leviesExpense, 0.0)
        assertEquals(900.0, summary.otherExpenses, 0.0)
        assertEquals(25000.0, summary.budgetPlanned)
        assertEquals(2, summary.awaitingConfirmationCount)
    }

    @Test
    fun `annual budget response maps the server-computed rollup verbatim, never re-summing months`() = runTest {
        val webApi = mockk<WebApi>()
        val response = AnnualBudgetResponse(
            months = listOf(
                AnnualBudgetMonthDto(month = "2026-01-01", plannedAmount = 1000.0, actualAmount = 500.0),
                AnnualBudgetMonthDto(month = "2026-02-01", plannedAmount = null, actualAmount = 0.0),
            ),
            annual = AnnualBudgetSummaryDto(
                year = 2026,
                monthsPlanned = 1,
                annualPlanned = 1000.0,
                annualActual = 500.0,
                annualRemaining = 500.0,
                annualPercentUsed = 50.0,
            ),
        )
        coEvery { webApi.getPropertyBudgetAnnual("property-1", 2026) } returns Response.success(response)
        val repository = WebApiFinancialSummaryRepository(webApi)

        val result = repository.getPropertyBudgetAnnual("property-1", 2026)

        require(result is AnnualBudgetResult.Loaded)
        assertEquals(1000.0, result.budget.annualPlanned, 0.0)
        assertEquals(500.0, result.budget.annualActual, 0.0)
        assertEquals(50.0, result.budget.annualPercentUsed)
        assertEquals(2, result.budget.months.size)
        assertEquals(1000.0, result.budget.months[0].plannedAmount)
        assertEquals(null, result.budget.months[1].plannedAmount)
    }
}
