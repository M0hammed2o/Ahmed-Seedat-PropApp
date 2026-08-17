package za.co.proplyst.app.ui.paymentreview

import za.co.proplyst.app.data.paymentreports.DocumentUrlResult
import za.co.proplyst.app.data.paymentreports.PaymentReport
import za.co.proplyst.app.data.paymentreports.PaymentReportsRepository
import za.co.proplyst.app.data.paymentreports.PaymentReportsResult
import za.co.proplyst.app.data.paymentreports.PaymentReviewResult
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PaymentReviewViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val sampleReport = PaymentReport(
        id = "r1",
        amount = 5000.0,
        paymentMethod = "eft",
        paymentDate = "2026-08-01",
        status = "reported",
        rejectionReason = null,
        createdAt = "2026-08-01T00:00:00Z",
        tenantName = "Jane Tenant",
        propertyName = "Sea Point Apartment",
        documentId = "doc-1",
    )

    private fun repositoryLoaded(vararg reports: PaymentReport): PaymentReportsRepository {
        val repository = mockk<PaymentReportsRepository>()
        coEvery { repository.getMyPaymentReports() } returns PaymentReportsResult.Loaded(reports.toList())
        return repository
    }

    @Test
    fun `emits Loaded when the repository returns reports`() = runTest {
        val repository = repositoryLoaded(sampleReport)

        val viewModel = PaymentReviewViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is PaymentReviewUiState.Loaded)
        assertEquals(listOf(sampleReport), (state as PaymentReviewUiState.Loaded).reports)
    }

    @Test
    fun `emits Empty when the repository returns no reports`() = runTest {
        val repository = repositoryLoaded()

        val viewModel = PaymentReviewViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value is PaymentReviewUiState.Empty)
    }

    @Test
    fun `emits Error when the repository fails`() = runTest {
        val repository = mockk<PaymentReportsRepository>()
        coEvery { repository.getMyPaymentReports() } returns PaymentReportsResult.Error("network error")

        val viewModel = PaymentReviewViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is PaymentReviewUiState.Error)
        assertEquals("network error", (state as PaymentReviewUiState.Error).message)
    }

    @Test
    fun `confirm calls the repository and reloads on success`() = runTest {
        val repository = repositoryLoaded(sampleReport)
        coEvery { repository.confirmPaymentReport("r1") } returns PaymentReviewResult.Success

        val viewModel = PaymentReviewViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.confirm("r1")
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { repository.confirmPaymentReport("r1") }
        coVerify(exactly = 2) { repository.getMyPaymentReports() }
        assertNull(viewModel.busyReportId.value)
        assertNull(viewModel.actionError.value)
    }

    @Test
    fun `confirm surfaces the repository's error and does not reload`() = runTest {
        val repository = repositoryLoaded(sampleReport)
        coEvery { repository.confirmPaymentReport("r1") } returns PaymentReviewResult.Error("Payment report not found.")

        val viewModel = PaymentReviewViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.confirm("r1")
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("Payment report not found.", viewModel.actionError.value)
        coVerify(exactly = 1) { repository.getMyPaymentReports() }
        assertNull(viewModel.busyReportId.value)
    }

    @Test
    fun `reject rejects a blank reason without calling the repository`() = runTest {
        val repository = repositoryLoaded(sampleReport)

        val viewModel = PaymentReviewViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.reject("r1", "  ")
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("A reason is required to reject a payment report.", viewModel.actionError.value)
        coVerify(exactly = 0) { repository.rejectPaymentReport(any(), any()) }
    }

    @Test
    fun `reject calls the repository and reloads on success`() = runTest {
        val repository = repositoryLoaded(sampleReport)
        coEvery { repository.rejectPaymentReport("r1", "Illegible proof") } returns PaymentReviewResult.Success

        val viewModel = PaymentReviewViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.reject("r1", "Illegible proof")
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { repository.rejectPaymentReport("r1", "Illegible proof") }
        coVerify(exactly = 2) { repository.getMyPaymentReports() }
        assertNull(viewModel.actionError.value)
    }

    @Test
    fun `openDocument sets documentUrl on success`() = runTest {
        val repository = repositoryLoaded(sampleReport)
        coEvery { repository.getDocumentUrl("doc-1") } returns
            DocumentUrlResult.Success(signedUrl = "https://example.test/proof.pdf", mimeType = "application/pdf")

        val viewModel = PaymentReviewViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.openDocument("doc-1")
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("https://example.test/proof.pdf", viewModel.documentUrl.value)
    }

    @Test
    fun `openDocument surfaces the repository's error and leaves documentUrl null`() = runTest {
        val repository = repositoryLoaded(sampleReport)
        coEvery { repository.getDocumentUrl("doc-1") } returns DocumentUrlResult.Error("Document not found.")

        val viewModel = PaymentReviewViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.openDocument("doc-1")
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("Document not found.", viewModel.actionError.value)
        assertNull(viewModel.documentUrl.value)
    }

    @Test
    fun `consumeDocumentUrl clears the documentUrl`() = runTest {
        val repository = repositoryLoaded(sampleReport)
        coEvery { repository.getDocumentUrl("doc-1") } returns
            DocumentUrlResult.Success(signedUrl = "https://example.test/proof.pdf", mimeType = "application/pdf")

        val viewModel = PaymentReviewViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.openDocument("doc-1")
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.consumeDocumentUrl()

        assertNull(viewModel.documentUrl.value)
    }
}
