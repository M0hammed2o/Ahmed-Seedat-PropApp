package za.co.proplyst.app.ui.invoices

import androidx.lifecycle.SavedStateHandle
import za.co.proplyst.app.data.invoices.InvoicePayment
import za.co.proplyst.app.data.invoices.InvoicesRepository
import za.co.proplyst.app.data.invoices.RecordPaymentInput
import za.co.proplyst.app.data.invoices.RecordPaymentResult
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
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

/** Invoice V1 completion pass (WORKLOG.md this date). Server remains authoritative for
 * overpayment/allocation rules (record_invoice_payment(), no bypass parameter exists) -- these
 * tests only pin down that the ViewModel submits the caller's own input as-is and relays
 * whatever the server decided (including a `would_overpay`/403 rejection), never a locally
 * pre-computed accept/reject decision. */
@OptIn(ExperimentalCoroutinesApi::class)
class RecordPaymentViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun savedStateHandle() = SavedStateHandle(mapOf("invoiceId" to "inv1"))

    private val samplePayment = InvoicePayment(
        id = "pay1",
        amount = 5000.0,
        paidAt = "2026-08-20",
        method = "eft",
        reference = "REF-1",
        notes = null,
        reversedAt = null,
        reversalReason = null,
        createdAt = "2026-08-20T00:00:00Z",
    )

    @Test
    fun `submit success flips uiState to Success and sends the caller's own input unchanged`() = runTest {
        val invoices = mockk<InvoicesRepository>()
        coEvery { invoices.recordPayment("inv1", any()) } returns RecordPaymentResult.Success(samplePayment)

        val viewModel = RecordPaymentViewModel(invoices, savedStateHandle())
        viewModel.submit(amount = 5000.0, paidAt = "2026-08-20", method = "eft", reference = "REF-1", notes = null)
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(RecordPaymentUiState.Success, viewModel.uiState.value)
        coVerify {
            invoices.recordPayment(
                "inv1",
                RecordPaymentInput(amount = 5000.0, paidAt = "2026-08-20", method = "eft", reference = "REF-1", notes = null),
            )
        }
    }

    @Test
    fun `submit surfaces the server's own would_overpay rejection verbatim, never a local check`() = runTest {
        val invoices = mockk<InvoicesRepository>()
        coEvery { invoices.recordPayment("inv1", any()) } returns
            RecordPaymentResult.Error("This payment would overpay the invoice by R100.00.")

        val viewModel = RecordPaymentViewModel(invoices, savedStateHandle())
        viewModel.submit(amount = 999999.0, paidAt = "2026-08-20", method = "eft", reference = null, notes = null)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is RecordPaymentUiState.Error)
        assertEquals("This payment would overpay the invoice by R100.00.", (state as RecordPaymentUiState.Error).message)
    }

    @Test
    fun `a second submit while one is already in flight is ignored`() = runTest {
        val invoices = mockk<InvoicesRepository>()
        val gate = CompletableDeferred<RecordPaymentResult>()
        coEvery { invoices.recordPayment("inv1", any()) } coAnswers { gate.await() }

        val viewModel = RecordPaymentViewModel(invoices, savedStateHandle())
        viewModel.submit(amount = 1000.0, paidAt = "2026-08-20", method = "cash", reference = null, notes = null)
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.submit(amount = 2000.0, paidAt = "2026-08-20", method = "cash", reference = null, notes = null)
        dispatcher.scheduler.advanceUntilIdle()

        gate.complete(RecordPaymentResult.Success(samplePayment))
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { invoices.recordPayment("inv1", any()) }
    }
}
