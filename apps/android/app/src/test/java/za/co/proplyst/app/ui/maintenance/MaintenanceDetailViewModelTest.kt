package za.co.proplyst.app.ui.maintenance

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import za.co.proplyst.app.data.documents.DocumentUrlResult
import za.co.proplyst.app.data.documents.TenantDocument
import za.co.proplyst.app.data.maintenance.AttachmentUploadResult
import za.co.proplyst.app.data.maintenance.AttachmentsResult
import za.co.proplyst.app.data.maintenance.MaintenanceRepository
import za.co.proplyst.app.data.maintenance.MaintenanceTicket
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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MaintenanceDetailViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun savedStateHandle() = SavedStateHandle(mapOf("ticketId" to "t1"))

    private val sampleTicket = MaintenanceTicket(
        id = "t1",
        orgId = "org1",
        propertyId = "p1",
        summary = "Test ticket",
        description = null,
        priority = "medium",
        status = "to_do",
        createdAt = "2026-08-01T00:00:00Z",
    )

    private val sampleAttachment = TenantDocument(
        id = "d1",
        originalFileName = "photo.jpg",
        mimeType = "image/jpeg",
        documentType = "supporting_document",
        createdAt = "2026-08-18T00:00:00Z",
    )

    private fun repositoryWithTicket(): MaintenanceRepository {
        val repository = mockk<MaintenanceRepository>()
        coEvery { repository.getTicketById("t1") } returns sampleTicket
        coEvery { repository.getAttachments("t1") } returns AttachmentsResult.Loaded(emptyList())
        return repository
    }

    @Test
    fun `loads the ticket and emits Loaded`() = runTest {
        val repository = repositoryWithTicket()

        val viewModel = MaintenanceDetailViewModel(repository, savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is MaintenanceDetailUiState.Loaded)
        assertEquals(sampleTicket, (state as MaintenanceDetailUiState.Loaded).ticket)
    }

    @Test
    fun `emits NotFound when the repository returns null`() = runTest {
        val repository = mockk<MaintenanceRepository>()
        coEvery { repository.getTicketById("t1") } returns null
        coEvery { repository.getAttachments("t1") } returns AttachmentsResult.Loaded(emptyList())

        val viewModel = MaintenanceDetailViewModel(repository, savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value is MaintenanceDetailUiState.NotFound)
    }

    @Test
    fun `loads attachments on init and emits Loaded`() = runTest {
        val repository = mockk<MaintenanceRepository>()
        coEvery { repository.getTicketById("t1") } returns sampleTicket
        coEvery { repository.getAttachments("t1") } returns AttachmentsResult.Loaded(listOf(sampleAttachment))

        val viewModel = MaintenanceDetailViewModel(repository, savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.attachmentsState.value
        assertTrue(state is AttachmentsUiState.Loaded)
        assertEquals(listOf(sampleAttachment), (state as AttachmentsUiState.Loaded).attachments)
    }

    @Test
    fun `emits Error when attachments fail to load`() = runTest {
        val repository = mockk<MaintenanceRepository>()
        coEvery { repository.getTicketById("t1") } returns sampleTicket
        coEvery { repository.getAttachments("t1") } returns AttachmentsResult.Error("network error")

        val viewModel = MaintenanceDetailViewModel(repository, savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.attachmentsState.value
        assertTrue(state is AttachmentsUiState.Error)
        assertEquals("network error", (state as AttachmentsUiState.Error).message)
    }

    @Test
    fun `uploadAttachment calls the repository and reloads attachments on success`() = runTest {
        val repository = repositoryWithTicket()
        val uri = mockk<Uri>()
        coEvery { repository.uploadAttachment("t1", uri) } returns AttachmentUploadResult.Success(sampleAttachment)

        val viewModel = MaintenanceDetailViewModel(repository, savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.uploadAttachment(uri)
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { repository.uploadAttachment("t1", uri) }
        coVerify(exactly = 2) { repository.getAttachments("t1") }
        assertTrue(viewModel.uploading.value.not())
        assertNull(viewModel.uploadError.value)
    }

    @Test
    fun `uploadAttachment surfaces the repository's error and does not reload`() = runTest {
        val repository = repositoryWithTicket()
        val uri = mockk<Uri>()
        coEvery { repository.uploadAttachment("t1", uri) } returns AttachmentUploadResult.Error("Failed to upload attachment.")

        val viewModel = MaintenanceDetailViewModel(repository, savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.uploadAttachment(uri)
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("Failed to upload attachment.", viewModel.uploadError.value)
        coVerify(exactly = 1) { repository.getAttachments("t1") }
    }

    @Test
    fun `openAttachment sets attachmentUrl on success`() = runTest {
        val repository = repositoryWithTicket()
        coEvery { repository.getAttachmentUrl("d1") } returns
            DocumentUrlResult.Success(signedUrl = "https://example.test/photo.jpg", mimeType = "image/jpeg")

        val viewModel = MaintenanceDetailViewModel(repository, savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.openAttachment("d1")
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("https://example.test/photo.jpg", viewModel.attachmentUrl.value)
    }

    @Test
    fun `consumeAttachmentUrl clears the attachmentUrl`() = runTest {
        val repository = repositoryWithTicket()
        coEvery { repository.getAttachmentUrl("d1") } returns
            DocumentUrlResult.Success(signedUrl = "https://example.test/photo.jpg", mimeType = "image/jpeg")

        val viewModel = MaintenanceDetailViewModel(repository, savedStateHandle())
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.openAttachment("d1")
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.consumeAttachmentUrl()

        assertNull(viewModel.attachmentUrl.value)
    }
}
