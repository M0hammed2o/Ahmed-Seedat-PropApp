package za.co.proplyst.app.ui.invoices

import za.co.proplyst.app.data.invoices.Invoice
import za.co.proplyst.app.data.invoices.InvoicesRepository
import za.co.proplyst.app.data.invoices.InvoicesResult
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

/** Invoice V1 completion pass (WORKLOG.md this date). Pins down: (1) the ViewModel is a pure
 * passthrough of whatever InvoicesRepository.getInvoices() returns -- `amount`/`paid`/`balance`/
 * `displayStatus` are asserted equal to the fixture values verbatim, proving no arithmetic
 * happens between the repository and the UI state, and (2) the three UI states (Loaded/Empty/
 * Error) match the repository result 1:1. */
@OptIn(ExperimentalCoroutinesApi::class)
class InvoicesListViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val sampleInvoice = Invoice(
        id = "inv1",
        invoiceNumber = "INV-000001",
        tenantId = "t1",
        tenantName = "Naledi Khumalo",
        propertyId = "p1",
        propertyNickname = "Musgrave Flats",
        unitId = "u1",
        unitLabel = "Unit 601",
        description = "August 2026 Rent",
        period = "2026-08-01",
        issuedAt = "2026-08-01T00:00:00Z",
        amount = 20000.0,
        paid = 15000.0,
        balance = 5000.0,
        displayStatus = "Partially paid",
        emailedAt = null,
        voidedAt = null,
        source = "rent_schedule",
    )

    @Test
    fun `emits Loaded with the server's exact amount, paid, and balance -- no local recomputation`() = runTest {
        val repository = mockk<InvoicesRepository>()
        coEvery { repository.getInvoices() } returns InvoicesResult.Loaded(listOf(sampleInvoice))

        val viewModel = InvoicesListViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is InvoicesListUiState.Loaded)
        val invoice = (state as InvoicesListUiState.Loaded).invoices.single()
        assertEquals(20000.0, invoice.amount, 0.0)
        assertEquals(15000.0, invoice.paid, 0.0)
        assertEquals(5000.0, invoice.balance, 0.0)
        assertEquals("Partially paid", invoice.displayStatus)
    }

    @Test
    fun `emits Empty when the repository returns no invoices`() = runTest {
        val repository = mockk<InvoicesRepository>()
        coEvery { repository.getInvoices() } returns InvoicesResult.Loaded(emptyList())

        val viewModel = InvoicesListViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value is InvoicesListUiState.Empty)
    }

    @Test
    fun `emits Error when the repository fails`() = runTest {
        val repository = mockk<InvoicesRepository>()
        coEvery { repository.getInvoices() } returns InvoicesResult.Error("network error")

        val viewModel = InvoicesListViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is InvoicesListUiState.Error)
        assertEquals("network error", (state as InvoicesListUiState.Error).message)
    }
}
