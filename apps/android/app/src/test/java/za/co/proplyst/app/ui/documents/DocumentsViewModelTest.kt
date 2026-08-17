package za.co.proplyst.app.ui.documents

import za.co.proplyst.app.data.documents.DocumentUrlResult
import za.co.proplyst.app.data.documents.TenantDocument
import za.co.proplyst.app.data.documents.TenantDocumentsRepository
import za.co.proplyst.app.data.documents.TenantDocumentsResult
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
class DocumentsViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val sampleDocument = TenantDocument(
        id = "d1",
        originalFileName = "Signed lease.pdf",
        mimeType = "application/pdf",
        documentType = "lease_agreement",
        createdAt = "2026-06-01T09:00:00Z",
    )

    @Test
    fun `emits Loaded when the repository returns documents`() = runTest {
        val repository = mockk<TenantDocumentsRepository>()
        coEvery { repository.getMyDocuments() } returns TenantDocumentsResult.Loaded(listOf(sampleDocument))

        val viewModel = DocumentsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is DocumentsUiState.Loaded)
        assertEquals(listOf(sampleDocument), (state as DocumentsUiState.Loaded).documents)
    }

    @Test
    fun `emits Empty when the repository returns no documents`() = runTest {
        val repository = mockk<TenantDocumentsRepository>()
        coEvery { repository.getMyDocuments() } returns TenantDocumentsResult.Loaded(emptyList())

        val viewModel = DocumentsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value is DocumentsUiState.Empty)
    }

    @Test
    fun `emits Error when the repository fails`() = runTest {
        val repository = mockk<TenantDocumentsRepository>()
        coEvery { repository.getMyDocuments() } returns TenantDocumentsResult.Error("network error")

        val viewModel = DocumentsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is DocumentsUiState.Error)
        assertEquals("network error", (state as DocumentsUiState.Error).message)
    }

    @Test
    fun `openDocument sets documentUrl on success`() = runTest {
        val repository = mockk<TenantDocumentsRepository>()
        coEvery { repository.getMyDocuments() } returns TenantDocumentsResult.Loaded(listOf(sampleDocument))
        coEvery { repository.getDocumentUrl("d1") } returns
            DocumentUrlResult.Success(signedUrl = "https://example.test/lease.pdf", mimeType = "application/pdf")

        val viewModel = DocumentsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.openDocument("d1")
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("https://example.test/lease.pdf", viewModel.documentUrl.value)
    }

    @Test
    fun `openDocument surfaces the repository's error and leaves documentUrl null`() = runTest {
        val repository = mockk<TenantDocumentsRepository>()
        coEvery { repository.getMyDocuments() } returns TenantDocumentsResult.Loaded(listOf(sampleDocument))
        coEvery { repository.getDocumentUrl("d1") } returns DocumentUrlResult.Error("Document not found.")

        val viewModel = DocumentsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.openDocument("d1")
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("Document not found.", viewModel.openError.value)
        assertNull(viewModel.documentUrl.value)
    }

    @Test
    fun `consumeDocumentUrl clears the documentUrl`() = runTest {
        val repository = mockk<TenantDocumentsRepository>()
        coEvery { repository.getMyDocuments() } returns TenantDocumentsResult.Loaded(listOf(sampleDocument))
        coEvery { repository.getDocumentUrl("d1") } returns
            DocumentUrlResult.Success(signedUrl = "https://example.test/lease.pdf", mimeType = "application/pdf")

        val viewModel = DocumentsViewModel(repository)
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.openDocument("d1")
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.consumeDocumentUrl()

        assertNull(viewModel.documentUrl.value)
    }
}
