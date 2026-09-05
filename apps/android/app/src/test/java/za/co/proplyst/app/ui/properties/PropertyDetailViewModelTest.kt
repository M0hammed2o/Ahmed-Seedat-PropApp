package za.co.proplyst.app.ui.properties

import androidx.lifecycle.SavedStateHandle
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import za.co.proplyst.app.data.financials.FinancialSummary
import za.co.proplyst.app.data.financials.FinancialSummaryRepository
import za.co.proplyst.app.data.financials.FinancialSummaryResult
import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.data.properties.PropertiesRepository

/**
 * Phase A budget-hierarchy pass (WORKLOG.md this date): Property Detail previously showed no
 * financial data at all. These prove the new financial-summary load (1) uses this property's own
 * id, not the portfolio-wide endpoint, (2) never blocks the already-loaded property from
 * rendering if the financial-summary call fails, and (3) reflects a genuine "not found" property
 * without ever attempting the financial-summary call at all.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PropertyDetailViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun property(id: String = "property-1") = Property(
        id = id,
        orgId = "org-1",
        nickname = "Test Property",
        fullAddress = "1 Test St",
        city = "Cape Town",
        province = null,
        propertyType = "house",
        municipalAccountNumber = null,
        notes = null,
        status = "active",
    )

    private fun financialSummary(planned: Double? = 25000.0) = FinancialSummary(
        month = "2026-09-01",
        rentPlanned = 12500.0,
        rentCollected = 12500.0,
        rentOutstanding = 0.0,
        utilitiesExpense = 0.0,
        ratesAndLeviesExpense = 0.0,
        otherExpenses = 0.0,
        totalExpenses = 18000.0,
        budgetPlanned = planned,
        budgetUsedPercent = 72.0,
        budgetRemaining = 7000.0,
        netOperatingPosition = 12500.0 - 18000.0,
        awaitingConfirmationCount = 0,
        budgetAlertLevel = null,
    )

    private fun savedStateHandle(propertyId: String = "property-1") = SavedStateHandle(mapOf("propertyId" to propertyId))

    @Test
    fun `loads the financial summary for this property's own id, not the portfolio`() = runTest {
        val propertiesRepository = mockk<PropertiesRepository>()
        coEvery { propertiesRepository.getPropertyById("property-1") } returns property()
        val financialSummaryRepository = mockk<FinancialSummaryRepository>()
        coEvery { financialSummaryRepository.getFinancialSummary("property-1", any()) } returns
            FinancialSummaryResult.Loaded(financialSummary())

        val vm = PropertyDetailViewModel(propertiesRepository, financialSummaryRepository, savedStateHandle())
        advanceUntilIdle()

        val state = vm.uiState.value as PropertyDetailUiState.Loaded
        assertEquals(25000.0, state.financialSummary?.budgetPlanned)
        assertEquals(false, state.financialSummaryLoading)
        assertNull(state.financialSummaryError)
        io.mockk.coVerify(exactly = 0) { financialSummaryRepository.getPortfolioFinancialSummary(any(), any()) }
    }

    @Test
    fun `a financial-summary failure surfaces its own error but the property itself still renders`() = runTest {
        val propertiesRepository = mockk<PropertiesRepository>()
        coEvery { propertiesRepository.getPropertyById("property-1") } returns property()
        val financialSummaryRepository = mockk<FinancialSummaryRepository>()
        coEvery { financialSummaryRepository.getFinancialSummary("property-1", any()) } returns
            FinancialSummaryResult.Error("Could not load the financial summary.")

        val vm = PropertyDetailViewModel(propertiesRepository, financialSummaryRepository, savedStateHandle())
        advanceUntilIdle()

        val state = vm.uiState.value as PropertyDetailUiState.Loaded
        assertEquals("Test Property", state.property.nickname)
        assertEquals("Could not load the financial summary.", state.financialSummaryError)
        assertNull(state.financialSummary)
    }

    @Test
    fun `a property that does not exist never attempts to load a financial summary`() = runTest {
        val propertiesRepository = mockk<PropertiesRepository>()
        coEvery { propertiesRepository.getPropertyById("missing") } returns null
        val financialSummaryRepository = mockk<FinancialSummaryRepository>()

        val vm = PropertyDetailViewModel(propertiesRepository, financialSummaryRepository, savedStateHandle("missing"))
        advanceUntilIdle()

        assertTrue(vm.uiState.value is PropertyDetailUiState.NotFound)
        io.mockk.coVerify(exactly = 0) { financialSummaryRepository.getFinancialSummary(any(), any()) }
    }
}
