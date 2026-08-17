package za.co.proplyst.app.ui.maintenance

import za.co.proplyst.app.data.maintenance.CreateMaintenanceTicketResult
import za.co.proplyst.app.data.maintenance.MaintenanceRepository
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CreateMaintenanceTicketViewModelTest {

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
    fun `submit rejects a blank summary without calling the repository`() = runTest {
        val repository = mockk<MaintenanceRepository>()
        val viewModel = CreateMaintenanceTicketViewModel(repository)

        viewModel.submit()
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.formState.value.error != null)
        assertTrue(viewModel.formState.value.submitted.not())
    }

    @Test
    fun `submit succeeds and flips submitted to true on a valid form`() = runTest {
        val repository = mockk<MaintenanceRepository>()
        val sampleTicket = MaintenanceTicket(
            id = "t1",
            orgId = "org1",
            propertyId = "prop1",
            summary = "Broken window latch",
            description = "Won't lock.",
            priority = "high",
            status = "to_do",
            createdAt = "2026-08-17T00:00:00Z",
        )
        coEvery { repository.createTicket(any(), any(), any()) } returns CreateMaintenanceTicketResult.Success(sampleTicket)

        val viewModel = CreateMaintenanceTicketViewModel(repository)
        viewModel.setSummary("Broken window latch")
        viewModel.setDescription("Won't lock.")
        viewModel.setPriority("high")
        viewModel.submit()
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.formState.value.submitted)
        assertTrue(viewModel.formState.value.error == null)
    }

    @Test
    fun `submit surfaces the repository's error message and does not mark submitted`() = runTest {
        val repository = mockk<MaintenanceRepository>()
        coEvery { repository.createTicket(any(), any(), any()) } returns
            CreateMaintenanceTicketResult.Error("Failed to submit maintenance ticket.")

        val viewModel = CreateMaintenanceTicketViewModel(repository)
        viewModel.setSummary("Broken window latch")
        viewModel.submit()
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("Failed to submit maintenance ticket.", viewModel.formState.value.error)
        assertTrue(viewModel.formState.value.submitted.not())
    }

    @Test
    fun `setDescription blank is sent as null description`() = runTest {
        val repository = mockk<MaintenanceRepository>()
        val sampleTicket = MaintenanceTicket(
            id = "t1",
            orgId = "org1",
            propertyId = "prop1",
            summary = "Broken window latch",
            description = null,
            priority = "medium",
            status = "to_do",
            createdAt = "2026-08-17T00:00:00Z",
        )
        coEvery { repository.createTicket("Broken window latch", null, "medium") } returns
            CreateMaintenanceTicketResult.Success(sampleTicket)

        val viewModel = CreateMaintenanceTicketViewModel(repository)
        viewModel.setSummary("Broken window latch")
        viewModel.submit()
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.formState.value.submitted)
    }
}
