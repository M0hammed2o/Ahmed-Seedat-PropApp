package za.co.proplyst.app.ui.notifications

import za.co.proplyst.app.data.notifications.AppNotification
import za.co.proplyst.app.data.notifications.MarkReadResult
import za.co.proplyst.app.data.notifications.NotificationsRepository
import za.co.proplyst.app.data.notifications.NotificationsResult
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NotificationsViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val sampleNotification = AppNotification(
        id = "n1",
        type = "payment_report.confirmed",
        title = "Payment confirmed",
        body = "Your payment was confirmed.",
        relatedEntityType = "payment_report",
        relatedEntityId = "pr1",
        readAt = null,
        createdAt = "2026-08-16T10:00:00Z",
    )

    @Test
    fun `emits Loaded when the repository returns notifications`() = runTest {
        val repository = mockk<NotificationsRepository>()
        coEvery { repository.getMyNotifications() } returns NotificationsResult.Loaded(listOf(sampleNotification))

        val viewModel = NotificationsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is NotificationsUiState.Loaded)
        assertEquals(listOf(sampleNotification), (state as NotificationsUiState.Loaded).notifications)
    }

    @Test
    fun `emits Empty when the repository returns no notifications`() = runTest {
        val repository = mockk<NotificationsRepository>()
        coEvery { repository.getMyNotifications() } returns NotificationsResult.Loaded(emptyList())

        val viewModel = NotificationsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value is NotificationsUiState.Empty)
    }

    @Test
    fun `emits Error when the repository fails`() = runTest {
        val repository = mockk<NotificationsRepository>()
        coEvery { repository.getMyNotifications() } returns NotificationsResult.Error("network error")

        val viewModel = NotificationsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is NotificationsUiState.Error)
        assertEquals("network error", (state as NotificationsUiState.Error).message)
    }

    @Test
    fun `markRead calls the repository and reloads on success`() = runTest {
        val repository = mockk<NotificationsRepository>()
        coEvery { repository.getMyNotifications() } returns NotificationsResult.Loaded(listOf(sampleNotification))
        coEvery { repository.markRead("n1") } returns MarkReadResult.Success

        val viewModel = NotificationsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.markRead("n1")
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { repository.markRead("n1") }
        coVerify(exactly = 2) { repository.getMyNotifications() }
    }

    @Test
    fun `markRead failure does not reload or crash`() = runTest {
        val repository = mockk<NotificationsRepository>()
        coEvery { repository.getMyNotifications() } returns NotificationsResult.Loaded(listOf(sampleNotification))
        coEvery { repository.markRead("n1") } returns MarkReadResult.Error("Notification not found.")

        val viewModel = NotificationsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.markRead("n1")
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { repository.markRead("n1") }
        coVerify(exactly = 1) { repository.getMyNotifications() }
    }
}
