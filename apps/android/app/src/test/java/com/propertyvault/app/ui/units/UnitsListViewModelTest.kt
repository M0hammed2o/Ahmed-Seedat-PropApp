package com.propertyvault.app.ui.units

import androidx.lifecycle.SavedStateHandle
import com.propertyvault.app.data.units.PropertyUnit
import com.propertyvault.app.data.units.UnitsRepository
import com.propertyvault.app.data.units.UnitsResult
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

/** Same StandardTestDispatcher + advanceUntilIdle() pattern as PropertiesListViewModelTest, for
 * the same reason (init { load() } launches on viewModelScope). */
@OptIn(ExperimentalCoroutinesApi::class)
class UnitsListViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val sampleUnit = PropertyUnit(
        id = "u1",
        propertyId = "p1",
        orgId = "org1",
        unitLabel = "Unit 1A",
        bedrooms = 2,
        bathrooms = 1,
        sizeSqm = 60.0,
        marketRent = 9000.0,
        status = "occupied",
    )

    private fun savedStateHandle() = SavedStateHandle(mapOf("propertyId" to "p1"))

    @Test
    fun `emits Loaded when the repository returns live units`() = runTest {
        val repository = mockk<UnitsRepository>()
        coEvery { repository.getUnitsByProperty("p1") } returns UnitsResult.Live(listOf(sampleUnit))

        val viewModel = UnitsListViewModel(repository, savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is UnitsListUiState.Loaded)
        state as UnitsListUiState.Loaded
        assertEquals(listOf(sampleUnit), state.units)
        assertNull(state.cachedAt)
    }

    @Test
    fun `emits Empty when the repository returns no units`() = runTest {
        val repository = mockk<UnitsRepository>()
        coEvery { repository.getUnitsByProperty("p1") } returns UnitsResult.Live(emptyList())

        val viewModel = UnitsListViewModel(repository, savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value is UnitsListUiState.Empty)
    }

    @Test
    fun `emits Loaded with a cachedAt timestamp when the repository falls back to cache`() = runTest {
        val repository = mockk<UnitsRepository>()
        coEvery { repository.getUnitsByProperty("p1") } returns UnitsResult.Cached(listOf(sampleUnit), 1_700_000_000_000L)

        val viewModel = UnitsListViewModel(repository, savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is UnitsListUiState.Loaded)
        assertNotNull((state as UnitsListUiState.Loaded).cachedAt)
    }

    @Test
    fun `emits Error when the repository fails with no cache to fall back to`() = runTest {
        val repository = mockk<UnitsRepository>()
        coEvery { repository.getUnitsByProperty("p1") } returns UnitsResult.Error("network error")

        val viewModel = UnitsListViewModel(repository, savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is UnitsListUiState.Error)
        assertEquals("network error", (state as UnitsListUiState.Error).message)
    }
}
