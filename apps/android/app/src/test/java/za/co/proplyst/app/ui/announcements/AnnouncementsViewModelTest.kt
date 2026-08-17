package za.co.proplyst.app.ui.announcements

import za.co.proplyst.app.data.announcements.AcknowledgeResult
import za.co.proplyst.app.data.announcements.Announcement
import za.co.proplyst.app.data.announcements.AnnouncementsRepository
import za.co.proplyst.app.data.announcements.AnnouncementsResult
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
import org.junit.Assert.assertNull
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

    private val sampleAnnouncement = Announcement(
        id = "a1",
        title = "Updated house rules",
        body = "Please acknowledge.",
        propertyId = "p1",
        requiresAcknowledgement = true,
        publishedAt = "2026-08-10T08:00:00Z",
        expiresAt = null,
    )

    @Test
    fun `emits Loaded when the repository returns announcements`() = runTest {
        val repository = mockk<AnnouncementsRepository>()
        coEvery { repository.getMyAnnouncements() } returns AnnouncementsResult.Loaded(listOf(sampleAnnouncement))

        val viewModel = AnnouncementsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is AnnouncementsUiState.Loaded)
        assertEquals(listOf(sampleAnnouncement), (state as AnnouncementsUiState.Loaded).announcements)
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
    fun `acknowledge adds the id to acknowledgedIds on success`() = runTest {
        val repository = mockk<AnnouncementsRepository>()
        coEvery { repository.getMyAnnouncements() } returns AnnouncementsResult.Loaded(listOf(sampleAnnouncement))
        coEvery { repository.acknowledge("a1") } returns AcknowledgeResult.Success

        val viewModel = AnnouncementsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.acknowledge("a1")
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue("a1" in viewModel.acknowledgedIds.value)
        assertNull(viewModel.busyId.value)
        assertNull(viewModel.actionError.value)
    }

    @Test
    fun `acknowledge surfaces the repository's error and does not mark acknowledged`() = runTest {
        val repository = mockk<AnnouncementsRepository>()
        coEvery { repository.getMyAnnouncements() } returns AnnouncementsResult.Loaded(listOf(sampleAnnouncement))
        coEvery { repository.acknowledge("a1") } returns AcknowledgeResult.Error("Announcement not found.")

        val viewModel = AnnouncementsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.acknowledge("a1")
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("Announcement not found.", viewModel.actionError.value)
        assertTrue("a1" !in viewModel.acknowledgedIds.value)
    }
}
