package za.co.proplyst.app.data.documents

import za.co.proplyst.app.data.network.WebApi
import za.co.proplyst.app.data.network.dto.DocumentDto
import za.co.proplyst.app.data.network.dto.WebApiErrorBody
import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import retrofit2.Response
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WebApiTenantDocumentsRepository @Inject constructor(
    private val webApi: WebApi,
) : TenantDocumentsRepository {

    private val errorJson = Json { ignoreUnknownKeys = true }

    override suspend fun getMyDocuments(): TenantDocumentsResult {
        return try {
            val response = webApi.getMyDocuments()
            if (!response.isSuccessful) {
                return TenantDocumentsResult.Error(errorMessage(response) ?: "Failed to load documents.")
            }
            val documents = response.body()?.documents.orEmpty().map { it.toDomain() }
            TenantDocumentsResult.Loaded(documents)
        } catch (e: Exception) {
            TenantDocumentsResult.Error(e.message ?: "Failed to load documents — check your connection.")
        }
    }

    override suspend fun getDocumentUrl(documentId: String): DocumentUrlResult {
        return try {
            val response = webApi.getDocument(documentId)
            if (!response.isSuccessful) {
                return DocumentUrlResult.Error(errorMessage(response) ?: "Failed to open this document.")
            }
            val body = response.body() ?: return DocumentUrlResult.Error("Failed to open this document.")
            DocumentUrlResult.Success(body.signedUrl, body.document.mimeType)
        } catch (e: Exception) {
            DocumentUrlResult.Error(e.message ?: "Failed to open this document — check your connection.")
        }
    }

    private fun errorMessage(response: Response<*>): String? {
        val raw = response.errorBody()?.string() ?: return null
        return try {
            errorJson.decodeFromString<WebApiErrorBody>(raw).error?.message
        } catch (_: Exception) {
            null
        }
    }

    private fun DocumentDto.toDomain() = TenantDocument(
        id = id,
        originalFileName = originalFileName,
        mimeType = mimeType,
        documentType = documentType,
        createdAt = createdAt,
    )
}
