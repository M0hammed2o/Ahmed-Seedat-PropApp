package za.co.proplyst.app.ui.budget

import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import za.co.proplyst.app.data.auth.AuthRepository
import za.co.proplyst.app.data.auth.AuthState
import za.co.proplyst.app.data.auth.OrgMembership
import za.co.proplyst.app.data.financials.AnnualBudget
import za.co.proplyst.app.data.financials.AnnualBudgetResult
import za.co.proplyst.app.data.financials.FinancialSummary
import za.co.proplyst.app.data.financials.FinancialSummaryRepository
import za.co.proplyst.app.data.financials.FinancialSummaryResult
import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.data.properties.PropertiesRepository
import za.co.proplyst.app.data.properties.PropertiesResult

/**
 * Phase A budget-hierarchy pass (WORKLOG.md this date): BudgetViewModel previously had zero unit
 * test coverage. These prove (1) portfolio vs property selection calls the correct repository
 * method with the correct id, (2) the Annual tab loads via the correct annual endpoint depending
 * on the current selection, and (3) the annual figures shown are exactly what the repository
 * returned -- never recomputed by summing months on-device (§17's explicit rule, tested here since
 * BudgetViewScreen just displays `state.annualBudget` fields verbatim).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BudgetViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun authRepository(orgId: String = "org-1") = mockk<AuthRepository>().also {
        every { it.authState } returns MutableStateFlow(
            AuthState.Authenticated(
                userId = "user-1",
                organizations = listOf(OrgMembership(orgId = orgId, role = "principal", status = "active")),
            ),
        )
    }

    private fun propertiesRepository(properties: List<Property> = emptyList()) = mockk<PropertiesRepository>().also {
        coEvery { it.getProperties() } returns PropertiesResult.Live(properties)
    }

    private fun financialSummary(planned: Double? = 25000.0, actual: Double = 18000.0) = FinancialSummary(
        month = "2026-09-01",
        rentPlanned = 0.0,
        rentCollected = 0.0,
        rentOutstanding = 0.0,
        utilitiesExpense = 0.0,
        ratesAndLeviesExpense = 0.0,
        otherExpenses = 0.0,
        totalExpenses = actual,
        budgetPlanned = planned,
        budgetUsedPercent = if (planned != null && planned != 0.0) (actual / planned) * 100 else null,
        budgetRemaining = if (planned != null) planned - actual else null,
        netOperatingPosition = -actual,
        awaitingConfirmationCount = 0,
        budgetAlertLevel = null,
    )

    @Test
    fun `loads the portfolio summary by default, not any single property`() = runTest {
        val financialSummaryRepository = mockk<FinancialSummaryRepository>()
        coEvery { financialSummaryRepository.getPortfolioFinancialSummary("org-1", any()) } returns
            FinancialSummaryResult.Loaded(financialSummary())

        val vm = BudgetViewModel(authRepository(), propertiesRepository(), financialSummaryRepository)
        advanceUntilIdle()

        assertEquals(null, vm.state.value.selectedPropertyId)
        assertEquals(25000.0, vm.state.value.summary?.budgetPlanned)
        io.mockk.coVerify(exactly = 0) { financialSummaryRepository.getFinancialSummary(any(), any()) }
    }

    @Test
    fun `selecting a property switches to the property-scoped endpoint with that property's id`() = runTest {
        val financialSummaryRepository = mockk<FinancialSummaryRepository>()
        coEvery { financialSummaryRepository.getPortfolioFinancialSummary(any(), any()) } returns
            FinancialSummaryResult.Loaded(financialSummary(planned = 25000.0))
        coEvery { financialSummaryRepository.getFinancialSummary("property-A", any()) } returns
            FinancialSummaryResult.Loaded(financialSummary(planned = 8000.0))

        val vm = BudgetViewModel(authRepository(), propertiesRepository(), financialSummaryRepository)
        advanceUntilIdle()

        vm.selectProperty("property-A")
        advanceUntilIdle()

        assertEquals("property-A", vm.state.value.selectedPropertyId)
        assertEquals(8000.0, vm.state.value.summary?.budgetPlanned)
        io.mockk.coVerify { financialSummaryRepository.getFinancialSummary("property-A", any()) }
    }

    @Test
    fun `switching to Annual for the portfolio calls the portfolio annual endpoint, never the property one`() = runTest {
        val annual = AnnualBudget(
            year = 2026,
            monthsPlanned = 3,
            annualPlanned = 75000.0,
            annualActual = 54000.0,
            annualRemaining = 21000.0,
            annualPercentUsed = 72.0,
            months = emptyList(),
        )
        val financialSummaryRepository = mockk<FinancialSummaryRepository>()
        coEvery { financialSummaryRepository.getPortfolioFinancialSummary(any(), any()) } returns
            FinancialSummaryResult.Loaded(financialSummary())
        coEvery { financialSummaryRepository.getPortfolioBudgetAnnual("org-1", 2026) } returns AnnualBudgetResult.Loaded(annual)

        val vm = BudgetViewModel(authRepository(), propertiesRepository(), financialSummaryRepository)
        advanceUntilIdle()

        vm.setPeriod(BudgetPeriod.ANNUAL)
        advanceUntilIdle()

        // The displayed figures are exactly the repository's numbers -- never re-derived here.
        assertEquals(annual, vm.state.value.annualBudget)
        io.mockk.coVerify(exactly = 0) { financialSummaryRepository.getPropertyBudgetAnnual(any(), any()) }
    }

    @Test
    fun `switching to Annual with a property selected calls the property annual endpoint for that property`() = runTest {
        val annual = AnnualBudget(
            year = 2026,
            monthsPlanned = 2,
            annualPlanned = 16000.0,
            annualActual = 12000.0,
            annualRemaining = 4000.0,
            annualPercentUsed = 75.0,
            months = emptyList(),
        )
        val financialSummaryRepository = mockk<FinancialSummaryRepository>()
        coEvery { financialSummaryRepository.getPortfolioFinancialSummary(any(), any()) } returns
            FinancialSummaryResult.Loaded(financialSummary())
        coEvery { financialSummaryRepository.getFinancialSummary("property-A", any()) } returns
            FinancialSummaryResult.Loaded(financialSummary(planned = 8000.0))
        coEvery { financialSummaryRepository.getPropertyBudgetAnnual("property-A", 2026) } returns AnnualBudgetResult.Loaded(annual)

        val vm = BudgetViewModel(authRepository(), propertiesRepository(), financialSummaryRepository)
        advanceUntilIdle()
        vm.selectProperty("property-A")
        advanceUntilIdle()

        vm.setPeriod(BudgetPeriod.ANNUAL)
        advanceUntilIdle()

        assertEquals(annual, vm.state.value.annualBudget)
        io.mockk.coVerify(exactly = 0) { financialSummaryRepository.getPortfolioBudgetAnnual(any(), any()) }
    }

    @Test
    fun `an annual load failure surfaces its own error without discarding the monthly summary already shown`() = runTest {
        val financialSummaryRepository = mockk<FinancialSummaryRepository>()
        coEvery { financialSummaryRepository.getPortfolioFinancialSummary(any(), any()) } returns
            FinancialSummaryResult.Loaded(financialSummary())
        coEvery { financialSummaryRepository.getPortfolioBudgetAnnual(any(), any()) } returns
            AnnualBudgetResult.Error("Could not load the annual budget.")

        val vm = BudgetViewModel(authRepository(), propertiesRepository(), financialSummaryRepository)
        advanceUntilIdle()
        vm.setPeriod(BudgetPeriod.ANNUAL)
        advanceUntilIdle()

        assertEquals("Could not load the annual budget.", vm.state.value.annualError)
        assertNull(vm.state.value.annualBudget)
        // The monthly summary loaded earlier is untouched by the annual tab's own failure.
        assertEquals(25000.0, vm.state.value.summary?.budgetPlanned)
    }
}
