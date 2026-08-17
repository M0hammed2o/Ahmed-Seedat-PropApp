package za.co.proplyst.app.ui.properties

import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.data.properties.PropertiesRepository
import za.co.proplyst.app.data.properties.PropertiesResult
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

/**
 * `dispatcher.scheduler.advanceUntilIdle()` (not Turbine) is used deliberately -- StateFlow's
 * `init { load() }` launches on `viewModelScope` (Dispatchers.Main, set to this test's
 * StandardTestDispatcher below), which needs its own scheduler advanced independently of
 * `runTest`'s own virtual-time scope. Kept simple and explicit rather than layering a stream-
 * assertion library on top, since this is unverified until a real `gradle test` run confirms it
 * compiles and passes -- see WORKLOG.md.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PropertiesListViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val sampleProperty = Property(
        id = "p1",
        orgId = "org1",
        nickname = "Test Property",
        fullAddress = "1 Test St",
        city = "Cape Town",
        province = null,
        propertyType = "house",
        municipalAccountNumber = null,
        notes = null,
        status = "active",
    )

    @Test
    fun `emits Loaded when the repository returns live properties`() = runTest {
        val repository = mockk<PropertiesRepository>()
        coEvery { repository.getProperties() } returns PropertiesResult.Live(listOf(sampleProperty))

        val viewModel = PropertiesListViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is PropertiesListUiState.Loaded)
        state as PropertiesListUiState.Loaded
        assertEquals(listOf(sampleProperty), state.properties)
        assertNull(state.cachedAt)
    }

    @Test
    fun `emits Empty when the repository returns no properties`() = runTest {
        val repository = mockk<PropertiesRepository>()
        coEvery { repository.getProperties() } returns PropertiesResult.Live(emptyList())

        val viewModel = PropertiesListViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value is PropertiesListUiState.Empty)
    }

    @Test
    fun `emits Loaded with a cachedAt timestamp when the repository falls back to cache`() = runTest {
        val repository = mockk<PropertiesRepository>()
        coEvery { repository.getProperties() } returns PropertiesResult.Cached(listOf(sampleProperty), 1_700_000_000_000L)

        val viewModel = PropertiesListViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is PropertiesListUiState.Loaded)
        assertNotNull((state as PropertiesListUiState.Loaded).cachedAt)
    }

    @Test
    fun `emits Error when the repository fails with no cache to fall back to`() = runTest {
        val repository = mockk<PropertiesRepository>()
        coEvery { repository.getProperties() } returns PropertiesResult.Error("network error")

        val viewModel = PropertiesListViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is PropertiesListUiState.Error)
        assertEquals("network error", (state as PropertiesListUiState.Error).message)
    }
}
