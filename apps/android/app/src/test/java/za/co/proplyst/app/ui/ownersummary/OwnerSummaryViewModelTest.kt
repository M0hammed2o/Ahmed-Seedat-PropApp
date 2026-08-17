package za.co.proplyst.app.ui.ownersummary

import za.co.proplyst.app.data.ownersummary.OwnerSummary
import za.co.proplyst.app.data.ownersummary.OwnerSummaryRepository
import za.co.proplyst.app.data.ownersummary.OwnerSummaryResult
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
class OwnerSummaryViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val sampleSummary = OwnerSummary(
        id = "s1",
        periodStart = "2026-08-01",
        periodEnd = "2026-08-31",
        propertyCount = 2,
        expectedRent = 21300.0,
        confirmedPaid = 18000.0,
        outstanding = 3300.0,
        awaitingConfirmation = 1200.0,
        openMaintenanceCount = 1,
        upcomingLeaseExpiryCount = 0,
        sentAt = "2026-08-01T08:00:00Z",
    )

    @Test
    fun `emits Loaded when the repository returns summaries`() = runTest {
        val repository = mockk<OwnerSummaryRepository>()
        coEvery { repository.getMySummaries() } returns OwnerSummaryResult.Loaded(listOf(sampleSummary))

        val viewModel = OwnerSummaryViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is OwnerSummaryUiState.Loaded)
        assertEquals(listOf(sampleSummary), (state as OwnerSummaryUiState.Loaded).summaries)
    }

    @Test
    fun `emits Empty when the repository returns no summaries`() = runTest {
        val repository = mockk<OwnerSummaryRepository>()
        coEvery { repository.getMySummaries() } returns OwnerSummaryResult.Loaded(emptyList())

        val viewModel = OwnerSummaryViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value is OwnerSummaryUiState.Empty)
    }

    @Test
    fun `emits Error when the repository fails`() = runTest {
        val repository = mockk<OwnerSummaryRepository>()
        coEvery { repository.getMySummaries() } returns OwnerSummaryResult.Error("network error")

        val viewModel = OwnerSummaryViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is OwnerSummaryUiState.Error)
        assertEquals("network error", (state as OwnerSummaryUiState.Error).message)
    }
}
