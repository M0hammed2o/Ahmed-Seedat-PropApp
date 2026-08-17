package za.co.proplyst.app.ui.paymentreports

import za.co.proplyst.app.data.paymentreports.PaymentReport
import za.co.proplyst.app.data.paymentreports.PaymentReportsRepository
import za.co.proplyst.app.data.paymentreports.PaymentReportsResult
import za.co.proplyst.app.data.paymentreports.ReportPaymentInput
import za.co.proplyst.app.data.paymentreports.ReportPaymentResult
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

@OptIn(ExperimentalCoroutinesApi::class)
class PaymentReportsViewModelTest {

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
    )

    @Test
    fun `emits Loaded when the repository returns reports`() = runTest {
        val repository = mockk<PaymentReportsRepository>()
        coEvery { repository.getMyPaymentReports() } returns PaymentReportsResult.Loaded(listOf(sampleReport))

        val viewModel = PaymentReportsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is PaymentReportsListUiState.Loaded)
        assertEquals(listOf(sampleReport), (state as PaymentReportsListUiState.Loaded).reports)
    }

    @Test
    fun `emits Empty when the repository returns no reports`() = runTest {
        val repository = mockk<PaymentReportsRepository>()
        coEvery { repository.getMyPaymentReports() } returns PaymentReportsResult.Loaded(emptyList())

        val viewModel = PaymentReportsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value is PaymentReportsListUiState.Empty)
    }

    @Test
    fun `emits Error when the repository fails`() = runTest {
        val repository = mockk<PaymentReportsRepository>()
        coEvery { repository.getMyPaymentReports() } returns PaymentReportsResult.Error("network error")

        val viewModel = PaymentReportsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is PaymentReportsListUiState.Error)
        assertEquals("network error", (state as PaymentReportsListUiState.Error).message)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class ReportPaymentViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `submit rejects a blank amount without calling the repository`() = runTest {
        val repository = mockk<PaymentReportsRepository>()
        val viewModel = ReportPaymentViewModel(repository)

        viewModel.setPaymentDate("2026-08-17")
        viewModel.submit()
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.formState.value.error != null)
        assertTrue(viewModel.formState.value.submitted.not())
    }

    @Test
    fun `submit rejects a blank payment date without calling the repository`() = runTest {
        val repository = mockk<PaymentReportsRepository>()
        val viewModel = ReportPaymentViewModel(repository)

        viewModel.setAmount("5000")
        viewModel.submit()
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.formState.value.error != null)
    }

    @Test
    fun `submit succeeds and flips submitted to true on a valid form`() = runTest {
        val repository = mockk<PaymentReportsRepository>()
        val sampleReport = PaymentReport(
            id = "r1",
            amount = 5000.0,
            paymentMethod = "eft",
            paymentDate = "2026-08-17",
            status = "reported",
            rejectionReason = null,
            createdAt = "2026-08-17T00:00:00Z",
        )
        coEvery { repository.reportPayment(any()) } returns ReportPaymentResult.Success(sampleReport)

        val viewModel = ReportPaymentViewModel(repository)
        viewModel.setAmount("5000")
        viewModel.setPaymentDate("2026-08-17")
        viewModel.submit()
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.formState.value.submitted)
        assertTrue(viewModel.formState.value.error == null)
    }

    @Test
    fun `submit surfaces the repository's error message and does not mark submitted`() = runTest {
        val repository = mockk<PaymentReportsRepository>()
        coEvery { repository.reportPayment(any<ReportPaymentInput>()) } returns
            ReportPaymentResult.Error("Failed to report payment.")

        val viewModel = ReportPaymentViewModel(repository)
        viewModel.setAmount("5000")
        viewModel.setPaymentDate("2026-08-17")
        viewModel.submit()
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("Failed to report payment.", viewModel.formState.value.error)
        assertTrue(viewModel.formState.value.submitted.not())
    }
}
