package za.co.proplyst.app.data.financials

import kotlinx.coroutines.delay
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MockFinancialSummaryRepository @Inject constructor() : FinancialSummaryRepository {

    override suspend fun getFinancialSummary(propertyId: String, month: String): FinancialSummaryResult {
        delay(200)
        return FinancialSummaryResult.Loaded(
            FinancialSummary(
                month = month,
                rentPlanned = 21300.0,
                rentCollected = 18000.0,
                rentOutstanding = 3300.0,
                utilitiesExpense = 2400.0,
                waterExpense = 1400.0,
                electricityExpense = 1000.0,
                ratesAndLeviesExpense = 3700.0,
                ratesTaxesExpense = 2450.0,
                leviesExpense = 1250.0,
                otherExpenses = 900.0,
                totalExpenses = 7000.0,
                budgetPlanned = 25000.0,
                budgetUsedPercent = 67.2,
                budgetRemaining = 8200.0,
                netOperatingPosition = 18000.0 - 7000.0,
                awaitingConfirmationCount = 1,
                budgetAlertLevel = null,
            ),
        )
    }

    override suspend fun getPortfolioFinancialSummary(orgId: String, month: String): FinancialSummaryResult {
        delay(200)
        return FinancialSummaryResult.Loaded(
            FinancialSummary(
                month = month,
                propertyCount = 2,
                rentPlanned = 21300.0,
                rentCollected = 18000.0,
                rentOutstanding = 3300.0,
                utilitiesExpense = 2400.0,
                waterExpense = 1400.0,
                electricityExpense = 1000.0,
                ratesAndLeviesExpense = 3700.0,
                ratesTaxesExpense = 2450.0,
                leviesExpense = 1250.0,
                otherExpenses = 900.0,
                totalExpenses = 7000.0,
                budgetPlanned = 25000.0,
                budgetUsedPercent = 67.2,
                budgetRemaining = 8200.0,
                netOperatingPosition = 18000.0 - 7000.0,
                awaitingConfirmationCount = 1,
                budgetAlertLevel = null,
            ),
        )
    }

    override suspend fun getPropertyBudgetAnnual(propertyId: String, year: Int): AnnualBudgetResult {
        delay(200)
        return AnnualBudgetResult.Loaded(mockAnnualBudget(year, monthlyPlanned = 8200.0, monthsSet = 8))
    }

    override suspend fun getPortfolioBudgetAnnual(orgId: String, year: Int): AnnualBudgetResult {
        delay(200)
        return AnnualBudgetResult.Loaded(mockAnnualBudget(year, monthlyPlanned = 25000.0, monthsSet = 8))
    }

    /** A realistic partial year -- most months set, the current one still open, matching what an
     *  owner who has only just started budgeting would actually see (same convention the web
     *  Annual budget panel's own demo-mode fixture uses). */
    private fun mockAnnualBudget(year: Int, monthlyPlanned: Double, monthsSet: Int): AnnualBudget {
        val months = (1..12).map { m ->
            val planned = if (m <= monthsSet) monthlyPlanned else null
            AnnualBudgetMonth(
                month = "$year-${m.toString().padStart(2, '0')}-01",
                plannedAmount = planned,
                actualAmount = if (planned != null) planned * 0.82 else 0.0,
            )
        }
        val annualPlanned = months.sumOf { it.plannedAmount ?: 0.0 }
        val annualActual = months.sumOf { it.actualAmount }
        return AnnualBudget(
            year = year,
            monthsPlanned = monthsSet,
            annualPlanned = annualPlanned,
            annualActual = annualActual,
            annualRemaining = annualPlanned - annualActual,
            annualPercentUsed = if (annualPlanned == 0.0) null else (annualActual / annualPlanned) * 100,
            months = months,
        )
    }

    override suspend fun getTenantPaymentStatus(propertyId: String, month: String): TenantPaymentStatusResult {
        delay(200)
        return TenantPaymentStatusResult.Loaded(
            listOf(
                TenantPaymentStatusRow(
                    rentScheduleId = "mock-rs-1",
                    tenantName = "Sarah Ndlovu",
                    unitLabel = "Unit 4B",
                    expectedRent = 12500.0,
                    confirmedPaid = 12500.0,
                    outstanding = 0.0,
                    status = "paid",
                    dueDate = "$month",
                ),
                TenantPaymentStatusRow(
                    rentScheduleId = "mock-rs-2",
                    tenantName = "Thabo Mokoena",
                    unitLabel = "Unit 5A",
                    expectedRent = 8800.0,
                    confirmedPaid = 0.0,
                    outstanding = 8800.0,
                    status = "overdue",
                    dueDate = "$month",
                ),
            ),
        )
    }
}
