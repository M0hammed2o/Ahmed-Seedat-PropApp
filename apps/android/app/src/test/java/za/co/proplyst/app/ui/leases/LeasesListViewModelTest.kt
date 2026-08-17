package za.co.proplyst.app.ui.leases

import androidx.lifecycle.SavedStateHandle
import za.co.proplyst.app.data.leases.Lease
import za.co.proplyst.app.data.leases.LeasesRepository
import za.co.proplyst.app.data.leases.LeasesResult
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
class LeasesListViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val sampleLease = Lease(
        id = "l1",
        orgId = "org1",
        unitId = "u1",
        startDate = "2026-01-01",
        endDate = null,
        rentAmount = 9000.0,
        rentFrequency = "monthly",
        depositAmount = 9000.0,
        status = "active",
    )

    private fun savedStateHandle() = SavedStateHandle(mapOf("unitId" to "u1"))

    @Test
    fun `emits Loaded when the repository returns live leases`() = runTest {
        val repository = mockk<LeasesRepository>()
        coEvery { repository.getLeasesByUnit("u1") } returns LeasesResult.Live(listOf(sampleLease))

        val viewModel = LeasesListViewModel(repository, savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is LeasesListUiState.Loaded)
        state as LeasesListUiState.Loaded
        assertEquals(listOf(sampleLease), state.leases)
        assertNull(state.cachedAt)
    }

    @Test
    fun `emits Empty when the repository returns no leases`() = runTest {
        val repository = mockk<LeasesRepository>()
        coEvery { repository.getLeasesByUnit("u1") } returns LeasesResult.Live(emptyList())

        val viewModel = LeasesListViewModel(repository, savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value is LeasesListUiState.Empty)
    }

    @Test
    fun `emits Loaded with a cachedAt timestamp when the repository falls back to cache`() = runTest {
        val repository = mockk<LeasesRepository>()
        coEvery { repository.getLeasesByUnit("u1") } returns LeasesResult.Cached(listOf(sampleLease), 1_700_000_000_000L)

        val viewModel = LeasesListViewModel(repository, savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is LeasesListUiState.Loaded)
        assertNotNull((state as LeasesListUiState.Loaded).cachedAt)
    }

    @Test
    fun `emits Error when the repository fails with no cache to fall back to`() = runTest {
        val repository = mockk<LeasesRepository>()
        coEvery { repository.getLeasesByUnit("u1") } returns LeasesResult.Error("network error")

        val viewModel = LeasesListViewModel(repository, savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is LeasesListUiState.Error)
        assertEquals("network error", (state as LeasesListUiState.Error).message)
    }
}
