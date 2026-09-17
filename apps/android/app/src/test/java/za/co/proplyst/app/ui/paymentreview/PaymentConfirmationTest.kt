package za.co.proplyst.app.ui.paymentreview

import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
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
import za.co.proplyst.app.data.paymentreports.PaymentReport
import za.co.proplyst.app.data.paymentreports.PaymentReportsRepository
import za.co.proplyst.app.data.paymentreports.PaymentReportsResult
import za.co.proplyst.app.data.paymentreports.PaymentReviewResult

/**
 * Confirming a reported payment (2026-09-17).
 *
 * Real-device testing hit an error on "Confirm payment received". The cause was server-side -- the
 * organisation had no chart of accounts, so the ledger posting was refused -- and these cover the
 * app's half of that story: the failure is shown rather than swallowed, the list is only reloaded on
 * success, and a double tap cannot record the payment twice.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PaymentConfirmationTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun report(id: String = "report-1") = PaymentReport(
        id = id,
        amount = 11450.0,
        paymentMethod = "eft",
        paymentDate = "2026-09-05",
        status = "reported",
        rejectionReason = null,
        createdAt = "2026-09-05T08:00:00Z",
        tenantName = "Nozipho Mthembu",
        propertyName = "Ballito Beach Apartments",
        documentId = null,
        reportedByTenant = true,
    )

    private fun viewModel(repository: PaymentReportsRepository) = PaymentReviewViewModel(repository)

    @Test
    fun `a confirmed payment reloads the list so the screen reflects the new state`() = runTest(dispatcher) {
        val repository = mockk<PaymentReportsRepository>(relaxed = true)
        coEvery { repository.getMyPaymentReports() } returns PaymentReportsResult.Loaded(listOf(report()))
        coEvery { repository.confirmPaymentReport("report-1") } returns PaymentReviewResult.Success
        val vm = viewModel(repository)
        advanceUntilIdle()

        vm.confirm("report-1")
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.confirmPaymentReport("report-1") }
        // Once on init, once after the confirmation.
        coVerify(exactly = 2) { repository.getMyPaymentReports() }
        assertNull(vm.actionError.value)
        assertNull(vm.busyReportId.value)
    }

    @Test
    fun `the server's own reason is shown, not a generic failure`() = runTest(dispatcher) {
        val repository = mockk<PaymentReportsRepository>(relaxed = true)
        coEvery { repository.getMyPaymentReports() } returns PaymentReportsResult.Loaded(listOf(report()))
        coEvery { repository.confirmPaymentReport(any()) } returns PaymentReviewResult.Error(
            "This organisation has no ledger accounts set up yet, so the payment cannot be posted. " +
                "Contact Proplyst support to finish the accounting setup. No changes were made.",
        )
        val vm = viewModel(repository)
        advanceUntilIdle()

        vm.confirm("report-1")
        advanceUntilIdle()

        val message = vm.actionError.value.orEmpty()
        assertTrue("must carry the server's explanation: $message", message.contains("ledger accounts"))
        assertTrue("must say nothing was changed: $message", message.contains("No changes were made"))
        assertNull("the row must not stay stuck in its busy state", vm.busyReportId.value)
    }

    @Test
    fun `a double tap confirms once`() = runTest(dispatcher) {
        val repository = mockk<PaymentReportsRepository>(relaxed = true)
        coEvery { repository.getMyPaymentReports() } returns PaymentReportsResult.Loaded(listOf(report()))
        coEvery { repository.confirmPaymentReport("report-1") } coAnswers {
            delay(500)
            PaymentReviewResult.Success
        }
        val vm = viewModel(repository)
        advanceUntilIdle()

        vm.confirm("report-1")
        dispatcher.scheduler.runCurrent()
        assertEquals("precondition: the first call is in flight", "report-1", vm.busyReportId.value)
        vm.confirm("report-1")
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.confirmPaymentReport("report-1") }
    }

    @Test
    fun `rejecting without a reason never reaches the server`() = runTest(dispatcher) {
        val repository = mockk<PaymentReportsRepository>(relaxed = true)
        coEvery { repository.getMyPaymentReports() } returns PaymentReportsResult.Loaded(listOf(report()))
        val vm = viewModel(repository)
        advanceUntilIdle()

        vm.reject("report-1", "   ")
        advanceUntilIdle()

        coVerify(exactly = 0) { repository.rejectPaymentReport(any(), any()) }
        assertTrue(vm.actionError.value.orEmpty().contains("reason", ignoreCase = true))
    }

    @Test
    fun `rejecting with a reason still works`() = runTest(dispatcher) {
        val repository = mockk<PaymentReportsRepository>(relaxed = true)
        coEvery { repository.getMyPaymentReports() } returns PaymentReportsResult.Loaded(listOf(report()))
        coEvery { repository.rejectPaymentReport("report-1", "Funds never arrived") } returns PaymentReviewResult.Success
        val vm = viewModel(repository)
        advanceUntilIdle()

        vm.reject("report-1", "Funds never arrived")
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.rejectPaymentReport("report-1", "Funds never arrived") }
        assertNull(vm.actionError.value)
    }
}
