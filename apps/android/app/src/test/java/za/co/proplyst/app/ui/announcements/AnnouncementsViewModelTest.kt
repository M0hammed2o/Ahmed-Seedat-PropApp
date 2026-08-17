package za.co.proplyst.app.ui.announcements

import za.co.proplyst.app.data.announcements.AcknowledgeResult
import za.co.proplyst.app.data.announcements.Announcement
import za.co.proplyst.app.data.announcements.AnnouncementsRepository
import za.co.proplyst.app.data.announcements.AnnouncementsResult
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
class AnnouncementsViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val requiredUnread = Announcement(
        id = "a1",
        title = "Updated house rules",
        body = "Please acknowledge.",
        propertyId = "p1",
        requiresAcknowledgement = true,
        publishedAt = "2026-08-10T08:00:00Z",
        expiresAt = null,
        readAt = null,
    )

    private val informationalUnread = Announcement(
        id = "a2",
        title = "Water shutoff Friday",
        body = "Scheduled maintenance.",
        propertyId = "p1",
        requiresAcknowledgement = false,
        publishedAt = "2026-08-10T08:00:00Z",
        expiresAt = null,
        readAt = null,
    )

    @Test
    fun `emits Loaded when the repository returns announcements`() = runTest {
        val repository = mockk<AnnouncementsRepository>()
        coEvery { repository.getMyAnnouncements() } returns AnnouncementsResult.Loaded(listOf(requiredUnread))

        val viewModel = AnnouncementsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is AnnouncementsUiState.Loaded)
        assertEquals(listOf(requiredUnread), (state as AnnouncementsUiState.Loaded).announcements)
    }

    @Test
    fun `emits Empty when the repository returns no announcements`() = runTest {
        val repository = mockk<AnnouncementsRepository>()
        coEvery { repository.getMyAnnouncements() } returns AnnouncementsResult.Loaded(emptyList())

        val viewModel = AnnouncementsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value is AnnouncementsUiState.Empty)
    }

    @Test
    fun `emits Error when the repository fails`() = runTest {
        val repository = mockk<AnnouncementsRepository>()
        coEvery { repository.getMyAnnouncements() } returns AnnouncementsResult.Error("network error")

        val viewModel = AnnouncementsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is AnnouncementsUiState.Error)
        assertEquals("network error", (state as AnnouncementsUiState.Error).message)
    }

    @Test
    fun `acknowledge calls the repository and reloads on success`() = runTest {
        val repository = mockk<AnnouncementsRepository>()
        coEvery { repository.getMyAnnouncements() } returns AnnouncementsResult.Loaded(listOf(requiredUnread))
        coEvery { repository.acknowledge("a1") } returns AcknowledgeResult.Success

        val viewModel = AnnouncementsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.acknowledge("a1")
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { repository.acknowledge("a1") }
        coVerify(exactly = 2) { repository.getMyAnnouncements() }
        assertEquals(null, viewModel.busyId.value)
        assertEquals(null, viewModel.actionError.value)
    }

    @Test
    fun `acknowledge surfaces the repository's error and does not reload`() = runTest {
        val repository = mockk<AnnouncementsRepository>()
        coEvery { repository.getMyAnnouncements() } returns AnnouncementsResult.Loaded(listOf(requiredUnread))
        coEvery { repository.acknowledge("a1") } returns AcknowledgeResult.Error("Announcement not found.")

        val viewModel = AnnouncementsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.acknowledge("a1")
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("Announcement not found.", viewModel.actionError.value)
        coVerify(exactly = 1) { repository.getMyAnnouncements() }
    }

    @Test
    fun `markReadIfUnread calls the repository for an unread informational announcement`() = runTest {
        val repository = mockk<AnnouncementsRepository>()
        coEvery { repository.getMyAnnouncements() } returns AnnouncementsResult.Loaded(listOf(informationalUnread))
        coEvery { repository.acknowledge("a2") } returns AcknowledgeResult.Success

        val viewModel = AnnouncementsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.markReadIfUnread(informationalUnread)
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { repository.acknowledge("a2") }
    }

    @Test
    fun `markReadIfUnread does nothing for an announcement that requires acknowledgement`() = runTest {
        val repository = mockk<AnnouncementsRepository>()
        coEvery { repository.getMyAnnouncements() } returns AnnouncementsResult.Loaded(listOf(requiredUnread))

        val viewModel = AnnouncementsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.markReadIfUnread(requiredUnread)
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 0) { repository.acknowledge(any()) }
    }

    @Test
    fun `markReadIfUnread does nothing for an already-read announcement`() = runTest {
        val repository = mockk<AnnouncementsRepository>()
        val alreadyRead = informationalUnread.copy(readAt = "2026-08-17T00:00:00Z")
        coEvery { repository.getMyAnnouncements() } returns AnnouncementsResult.Loaded(listOf(alreadyRead))

        val viewModel = AnnouncementsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.markReadIfUnread(alreadyRead)
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 0) { repository.acknowledge(any()) }
    }

    @Test
    fun `markReadIfUnread only calls the repository once per load for the same announcement`() = runTest {
        val repository = mockk<AnnouncementsRepository>()
        coEvery { repository.getMyAnnouncements() } returns AnnouncementsResult.Loaded(listOf(informationalUnread))
        coEvery { repository.acknowledge("a2") } returns AcknowledgeResult.Success

        val viewModel = AnnouncementsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.markReadIfUnread(informationalUnread)
        viewModel.markReadIfUnread(informationalUnread)
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { repository.acknowledge("a2") }
    }
}
