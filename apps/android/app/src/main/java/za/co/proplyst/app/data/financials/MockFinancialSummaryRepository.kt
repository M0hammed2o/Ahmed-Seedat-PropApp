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
                ratesAndLeviesExpense = 3700.0,
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
                ratesAndLeviesExpense = 3700.0,
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
