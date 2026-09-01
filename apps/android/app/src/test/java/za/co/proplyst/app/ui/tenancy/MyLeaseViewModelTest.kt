package za.co.proplyst.app.ui.tenancy

import za.co.proplyst.app.data.tenancy.TenancyLease
import za.co.proplyst.app.data.tenancy.TenancyLeaseResult
import za.co.proplyst.app.data.tenancy.TenancyRepository
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
class MyLeaseViewModelTest {

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
    fun `emits Loaded when the repository returns a lease`() = runTest {
        val repository = mockk<TenancyRepository>()
        val lease = TenancyLease(
            tenantId = "t1",
            orgId = "org1",
            propertyNickname = "Musgrave Flats",
            propertyAddress = "12 Musgrave Road",
            unitLabel = "Unit 601",
            leaseStatus = "active",
            startDate = "2026-02-01",
            endDate = null,
            rentAmount = 20000.0,
        )
        coEvery { repository.getMyLease() } returns TenancyLeaseResult.Loaded(lease)

        val viewModel = MyLeaseViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is MyLeaseUiState.Loaded)
        assertEquals(lease, (state as MyLeaseUiState.Loaded).lease)
    }

    @Test
    fun `emits NoTenancy when the caller has no tenancy on file`() = runTest {
        val repository = mockk<TenancyRepository>()
        coEvery { repository.getMyLease() } returns TenancyLeaseResult.NoTenancy

        val viewModel = MyLeaseViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value is MyLeaseUiState.NoTenancy)
    }

    @Test
    fun `emits Error when the repository fails`() = runTest {
        val repository = mockk<TenancyRepository>()
        coEvery { repository.getMyLease() } returns TenancyLeaseResult.Error("network error")

        val viewModel = MyLeaseViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is MyLeaseUiState.Error)
        assertEquals("network error", (state as MyLeaseUiState.Error).message)
    }
}
