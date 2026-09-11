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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
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

    // ---- READ semantics (actionable-alerts pass) ----
    //
    // markRead used to re-fetch the whole feed on success. It now applies the change locally and
    // keeps it, which is what lets the row update under the user's finger while the destination is
    // opening. These tests assert the behaviour that actually matters -- the row's read state, and
    // that the row SURVIVES -- rather than the number of round trips.

    @Test
    fun `markRead marks the row read without refetching the feed`() = runTest {
        val repository = mockk<NotificationsRepository>()
        coEvery { repository.getMyNotifications() } returns NotificationsResult.Loaded(listOf(sampleNotification))
        coEvery { repository.markRead("n1") } returns MarkReadResult.Success

        val viewModel = NotificationsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.markRead("n1")
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { repository.markRead("n1") }
        coVerify(exactly = 1) { repository.getMyNotifications() }
        val row = (viewModel.uiState.value as NotificationsUiState.Loaded).notifications.single()
        assertNotNull("opening an activity must mark it read", row.readAt)
    }

    @Test
    fun `read is not resolved -- the activity stays in the feed as history`() = runTest {
        val repository = mockk<NotificationsRepository>()
        coEvery { repository.getMyNotifications() } returns NotificationsResult.Loaded(listOf(sampleNotification))
        coEvery { repository.markRead("n1") } returns MarkReadResult.Success

        val viewModel = NotificationsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.markRead("n1")
        dispatcher.scheduler.advanceUntilIdle()

        val rows = (viewModel.uiState.value as NotificationsUiState.Loaded).notifications
        assertEquals("reading an activity must never delete it", 1, rows.size)
        assertEquals("n1", rows.single().id)
    }

    @Test
    fun `markRead reverts the row when the write fails`() = runTest {
        val repository = mockk<NotificationsRepository>()
        coEvery { repository.getMyNotifications() } returns NotificationsResult.Loaded(listOf(sampleNotification))
        coEvery { repository.markRead("n1") } returns MarkReadResult.Error("Notification not found.")

        val viewModel = NotificationsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.markRead("n1")
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { repository.markRead("n1") }
        coVerify(exactly = 1) { repository.getMyNotifications() }
        val row = (viewModel.uiState.value as NotificationsUiState.Loaded).notifications.single()
        assertNull("a failed write must not leave the row looking read", row.readAt)
    }

    @Test
    fun `markRead on an already-read row does not call the repository`() = runTest {
        val alreadyRead = sampleNotification.copy(readAt = "2026-09-01T00:00:00Z")
        val repository = mockk<NotificationsRepository>()
        coEvery { repository.getMyNotifications() } returns NotificationsResult.Loaded(listOf(alreadyRead))

        val viewModel = NotificationsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.markRead("n1")
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 0) { repository.markRead(any()) }
    }

    @Test
    fun `refresh keeps the existing list when the reload fails`() = runTest {
        val repository = mockk<NotificationsRepository>()
        coEvery { repository.getMyNotifications() } returns NotificationsResult.Loaded(listOf(sampleNotification))

        val viewModel = NotificationsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        // Coming back from a destination while offline must not replace real history with an
        // error page.
        coEvery { repository.getMyNotifications() } returns NotificationsResult.Error("offline")
        viewModel.refresh()
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is NotificationsUiState.Loaded)
        assertEquals(listOf(sampleNotification), (state as NotificationsUiState.Loaded).notifications)
    }

    @Test
    fun `refresh picks up a resolved condition disappearing from the feed`() = runTest {
        val repository = mockk<NotificationsRepository>()
        coEvery { repository.getMyNotifications() } returns NotificationsResult.Loaded(listOf(sampleNotification))

        val viewModel = NotificationsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        coEvery { repository.getMyNotifications() } returns NotificationsResult.Loaded(emptyList())
        viewModel.refresh()
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value is NotificationsUiState.Empty)
    }
}
