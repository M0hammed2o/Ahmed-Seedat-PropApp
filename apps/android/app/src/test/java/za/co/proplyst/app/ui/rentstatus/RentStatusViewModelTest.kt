package za.co.proplyst.app.ui.rentstatus

import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import za.co.proplyst.app.data.financials.FinancialSummaryRepository
import za.co.proplyst.app.data.financials.TenantPaymentStatusResult
import za.co.proplyst.app.data.financials.TenantPaymentStatusRow
import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.data.properties.PropertiesRepository
import za.co.proplyst.app.data.properties.PropertiesResult

/** V1 utilities/rates/levies/budgets pass (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §6) -- the paid/
 * unpaid rent status screen must be server-authoritative (rent_schedules.status via the repository,
 * never recomputed/inferred on-device) and its filter must partition rows by that same status
 * field, never by a client-guessed rule. */
@OptIn(ExperimentalCoroutinesApi::class)
class RentStatusViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun property(id: String) = Property(
        id = id,
        orgId = "org-1",
        nickname = "Edendale Apartments",
        fullAddress = "1 Test St",
        city = "Cape Town",
        province = "Western Cape",
        propertyType = "apartment_block",
        municipalAccountNumber = null,
        notes = null,
        status = "active",
    )

    private fun row(status: String, id: String = "rs-$status") = TenantPaymentStatusRow(
        rentScheduleId = id,
        tenantName = "Test Tenant",
        unitLabel = "Unit 1",
        expectedRent = 10000.0,
        confirmedPaid = if (status == "paid") 10000.0 else 0.0,
        outstanding = if (status == "paid") 0.0 else 10000.0,
        status = status,
        dueDate = "2026-09-01",
    )

    @Test
    fun `selects the first property automatically and loads its rent status`() = runTest {
        val propertiesRepo = mockk<PropertiesRepository>()
        val financialRepo = mockk<FinancialSummaryRepository>()
        coEvery { propertiesRepo.getProperties() } returns PropertiesResult.Live(listOf(property("p1"), property("p2")))
        coEvery { financialRepo.getTenantPaymentStatus("p1", any()) } returns
            TenantPaymentStatusResult.Loaded(listOf(row("paid"), row("overdue")))

        val viewModel = RentStatusViewModel(financialRepo, propertiesRepo)
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("p1", viewModel.selectedPropertyId.value)
        val state = viewModel.uiState.value
        assertTrue(state is RentStatusUiState.Loaded)
        assertEquals(2, (state as RentStatusUiState.Loaded).rows.size)
    }

    @Test
    fun `no properties yields the empty NoProperties state, not a spinner forever`() = runTest {
        val propertiesRepo = mockk<PropertiesRepository>()
        val financialRepo = mockk<FinancialSummaryRepository>()
        coEvery { propertiesRepo.getProperties() } returns PropertiesResult.Live(emptyList())

        val viewModel = RentStatusViewModel(financialRepo, propertiesRepo)
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value is RentStatusUiState.NoProperties)
    }

    @Test
    fun `switching the selected property reloads rent status for that property`() = runTest {
        val propertiesRepo = mockk<PropertiesRepository>()
        val financialRepo = mockk<FinancialSummaryRepository>()
        coEvery { propertiesRepo.getProperties() } returns PropertiesResult.Live(listOf(property("p1"), property("p2")))
        coEvery { financialRepo.getTenantPaymentStatus("p1", any()) } returns
            TenantPaymentStatusResult.Loaded(listOf(row("paid")))
        coEvery { financialRepo.getTenantPaymentStatus("p2", any()) } returns
            TenantPaymentStatusResult.Loaded(listOf(row("overdue"), row("partial"), row("pending")))

        val viewModel = RentStatusViewModel(financialRepo, propertiesRepo)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.selectProperty("p2")
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("p2", viewModel.selectedPropertyId.value)
        val state = viewModel.uiState.value
        assertTrue(state is RentStatusUiState.Loaded)
        assertEquals(3, (state as RentStatusUiState.Loaded).rows.size)
    }

    @Test
    fun `a repository error surfaces as the Error state with its message`() = runTest {
        val propertiesRepo = mockk<PropertiesRepository>()
        val financialRepo = mockk<FinancialSummaryRepository>()
        coEvery { propertiesRepo.getProperties() } returns PropertiesResult.Live(listOf(property("p1")))
        coEvery { financialRepo.getTenantPaymentStatus("p1", any()) } returns
            TenantPaymentStatusResult.Error("Failed to load rent status -- check your connection.")

        val viewModel = RentStatusViewModel(financialRepo, propertiesRepo)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is RentStatusUiState.Error)
        assertEquals("Failed to load rent status -- check your connection.", (state as RentStatusUiState.Error).message)
    }
}
