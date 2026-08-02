package com.propertyvault.app.ui.tenants

import com.propertyvault.app.data.tenants.Tenant
import com.propertyvault.app.data.tenants.TenantsRepository
import com.propertyvault.app.data.tenants.TenantsResult
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
class TenantsListViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val sampleTenant = Tenant(
        id = "t1",
        orgId = "org1",
        fullName = "Test Tenant",
        email = "tenant@example.com",
        phone = null,
        status = "active",
    )

    @Test
    fun `emits Loaded when the repository returns live tenants`() = runTest {
        val repository = mockk<TenantsRepository>()
        coEvery { repository.getTenants() } returns TenantsResult.Live(listOf(sampleTenant))

        val viewModel = TenantsListViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is TenantsListUiState.Loaded)
        state as TenantsListUiState.Loaded
        assertEquals(listOf(sampleTenant), state.tenants)
        assertNull(state.cachedAt)
    }

    @Test
    fun `emits Empty when the repository returns no tenants`() = runTest {
        val repository = mockk<TenantsRepository>()
        coEvery { repository.getTenants() } returns TenantsResult.Live(emptyList())

        val viewModel = TenantsListViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value is TenantsListUiState.Empty)
    }

    @Test
    fun `emits Loaded with a cachedAt timestamp when the repository falls back to cache`() = runTest {
        val repository = mockk<TenantsRepository>()
        coEvery { repository.getTenants() } returns TenantsResult.Cached(listOf(sampleTenant), 1_700_000_000_000L)

        val viewModel = TenantsListViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is TenantsListUiState.Loaded)
        assertNotNull((state as TenantsListUiState.Loaded).cachedAt)
    }

    @Test
    fun `emits Error when the repository fails with no cache to fall back to`() = runTest {
        val repository = mockk<TenantsRepository>()
        coEvery { repository.getTenants() } returns TenantsResult.Error("network error")

        val viewModel = TenantsListViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is TenantsListUiState.Error)
        assertEquals("network error", (state as TenantsListUiState.Error).message)
    }
}
