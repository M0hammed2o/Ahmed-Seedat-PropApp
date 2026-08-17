package za.co.proplyst.app.data.documents

import kotlinx.coroutines.delay
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MockTenantDocumentsRepository @Inject constructor() : TenantDocumentsRepository {

    private val documents = listOf(
        TenantDocument(
            id = "demo-document-lease-1",
            originalFileName = "Signed lease agreement.pdf",
            mimeType = "application/pdf",
            documentType = "lease_agreement",
            createdAt = "2026-06-01T09:00:00Z",
        ),
        TenantDocument(
            id = "demo-document-1",
            originalFileName = "August rent receipt.pdf",
            mimeType = "application/pdf",
            documentType = "receipt",
            createdAt = "2026-08-01T09:00:00Z",
        ),
    )

    override suspend fun getMyDocuments(): TenantDocumentsResult {
        delay(300)
        return TenantDocumentsResult.Loaded(documents)
    }

    override suspend fun getDocumentUrl(documentId: String): DocumentUrlResult {
        delay(200)
        return DocumentUrlResult.Success(
            signedUrl = "https://example.test/demo-document.pdf",
            mimeType = "application/pdf",
        )
    }
}
