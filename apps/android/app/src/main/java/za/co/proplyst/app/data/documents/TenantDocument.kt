package za.co.proplyst.app.data.documents

/** Android V1 final gap-closure pass (WORKLOG.md this date), Phase 5. RLS
 * (`documents_select_tenant_self`, migration 20260101000049) is the real scope: a document is
 * only visible here if staff explicitly tagged it with this tenant's own lease_id -- never a
 * blanket property-scoped grant (a property's documents include owner-only paperwork). */
data class TenantDocument(
    val id: String,
    val originalFileName: String?,
    val mimeType: String?,
    val documentType: String?,
    val createdAt: String?,
)

sealed interface TenantDocumentsResult {
    data class Loaded(val documents: List<TenantDocument>) : TenantDocumentsResult
    data class Error(val message: String) : TenantDocumentsResult
}

sealed interface DocumentUrlResult {
    data class Success(val signedUrl: String, val mimeType: String?) : DocumentUrlResult
    data class Error(val message: String) : DocumentUrlResult
}

/** One real implementation (WebApiTenantDocumentsRepository) and one mock, same split every
 * other repository in this app uses. Opening a document reuses the SAME signed-URL endpoint
 * (`GET /api/v1/documents/:id`) Phase 3's payment-review "view proof of payment" already calls --
 * a private bucket, 5-minute TTL, RLS-gated -- not a separate implementation. */
interface TenantDocumentsRepository {
    suspend fun getMyDocuments(): TenantDocumentsResult
    suspend fun getDocumentUrl(documentId: String): DocumentUrlResult
}
