package za.co.proplyst.app.ui.maintenance

import za.co.proplyst.app.data.maintenance.MaintenanceRepository
import za.co.proplyst.app.data.maintenance.MaintenanceResult
import za.co.proplyst.app.data.maintenance.MaintenanceTicket
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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MaintenanceListViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val sampleTicket = MaintenanceTicket(
        id = "t1",
        orgId = "org1",
        propertyId = "p1",
        summary = "Test ticket",
        description = null,
        priority = "medium",
        status = "to_do",
        createdAt = "2026-08-01T00:00:00Z",
    )

    @Test
    fun `emits Loaded when the repository returns live tickets`() = runTest {
        val repository = mockk<MaintenanceRepository>()
        coEvery { repository.getTickets() } returns MaintenanceResult.Live(listOf(sampleTicket))

        val viewModel = MaintenanceListViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is MaintenanceListUiState.Loaded)
        state as MaintenanceListUiState.Loaded
        assertEquals(listOf(sampleTicket), state.tickets)
        assertNull(state.cachedAt)
    }

    @Test
    fun `emits Empty when the repository returns no tickets`() = runTest {
        val repository = mockk<MaintenanceRepository>()
        coEvery { repository.getTickets() } returns MaintenanceResult.Live(emptyList())

        val viewModel = MaintenanceListViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value is MaintenanceListUiState.Empty)
    }

    @Test
    fun `emits Loaded with a cachedAt timestamp when the repository falls back to cache`() = runTest {
        val repository = mockk<MaintenanceRepository>()
        coEvery { repository.getTickets() } returns MaintenanceResult.Cached(listOf(sampleTicket), 1_700_000_000_000L)

        val viewModel = MaintenanceListViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is MaintenanceListUiState.Loaded)
        assertNotNull((state as MaintenanceListUiState.Loaded).cachedAt)
    }

    @Test
    fun `emits Error when the repository fails with no cache to fall back to`() = runTest {
        val repository = mockk<MaintenanceRepository>()
        coEvery { repository.getTickets() } returns MaintenanceResult.Error("network error")

        val viewModel = MaintenanceListViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is MaintenanceListUiState.Error)
        assertEquals("network error", (state as MaintenanceListUiState.Error).message)
    }
}
