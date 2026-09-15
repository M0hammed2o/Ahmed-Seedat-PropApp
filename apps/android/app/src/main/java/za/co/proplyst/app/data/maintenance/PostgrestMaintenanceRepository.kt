package za.co.proplyst.app.data.maintenance

import android.content.Context
import android.net.Uri
import za.co.proplyst.app.data.documents.DocumentUrlResult
import za.co.proplyst.app.data.documents.TenantDocument
import za.co.proplyst.app.data.local.MaintenanceTicketDao
import za.co.proplyst.app.data.local.MaintenanceTicketEntity
import za.co.proplyst.app.data.network.PostgrestApi
import za.co.proplyst.app.data.network.WebApi
import za.co.proplyst.app.data.network.dto.CreateTenantMaintenanceTicketRequest
import za.co.proplyst.app.data.network.dto.DocumentDto
import za.co.proplyst.app.data.network.dto.MaintenanceTicketCreatedDto
import za.co.proplyst.app.data.network.dto.MaintenanceTicketDto
import za.co.proplyst.app.data.network.dto.WebApiErrorBody
import za.co.proplyst.app.data.network.prepareUpload
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import retrofit2.Response
import javax.inject.Inject

class PostgrestMaintenanceRepository @Inject constructor(
    private val api: PostgrestApi,
    private val webApi: WebApi,
    private val dao: MaintenanceTicketDao,
    @ApplicationContext private val context: Context,
) : MaintenanceRepository {

    private val errorJson = Json { ignoreUnknownKeys = true }

    /** Sensitive-upload-gate UX pass (WORKLOG.md this date): surfaces the SERVER's own
     * user-facing message (e.g. scanUploadOrRespond()'s professional, ClamAV-free 503 wording,
     * "Document uploads are temporarily unavailable while secure file scanning is being
     * configured.") instead of a bare status code -- same established pattern
     * WebApiPaymentReportsRepository's own proof-of-payment upload already uses. Never leaks
     * internal provider/infrastructure terminology, since it only ever repeats back exactly what
     * the server itself chose to say. */
    private fun errorMessage(response: Response<*>): String? {
        val raw = response.errorBody()?.string() ?: return null
        return try {
            errorJson.decodeFromString<WebApiErrorBody>(raw).error?.message
        } catch (_: Exception) {
            null
        }
    }

    override suspend fun getTickets(): MaintenanceResult {
        return try {
            val response = api.getMaintenanceTickets()
            val body = response.body()
            if (!response.isSuccessful || body == null) {
                return fallbackToCache("Failed to load maintenance tickets (${response.code()})")
            }
            val now = System.currentTimeMillis()
            dao.replaceAll(body.map { it.toEntity(now) })
            MaintenanceResult.Live(body.map { it.toDomain() })
        } catch (e: Exception) {
            fallbackToCache(e.message ?: "Failed to load maintenance tickets")
        }
    }

    override suspend fun getTicketById(id: String): MaintenanceTicket? {
        return try {
            val response = api.getMaintenanceTicketById(idFilter = "eq.$id")
            response.body()?.firstOrNull()?.toDomain()
                ?: dao.getById(id)?.toDomain()
        } catch (_: Exception) {
            dao.getById(id)?.toDomain()
        }
    }

    override suspend fun createTicket(
        summary: String,
        description: String?,
        priority: String,
    ): CreateMaintenanceTicketResult {
        if (summary.isBlank()) return CreateMaintenanceTicketResult.Error("Summary is required.")
        return try {
            val response = webApi.createTenantMaintenanceTicket(
                CreateTenantMaintenanceTicketRequest(summary = summary, description = description, priority = priority),
            )
            val body = response.body()
            if (!response.isSuccessful || body == null) {
                CreateMaintenanceTicketResult.Error("Failed to submit maintenance ticket (${response.code()})")
            } else {
                CreateMaintenanceTicketResult.Success(body.maintenanceTicket.toDomain())
            }
        } catch (e: Exception) {
            CreateMaintenanceTicketResult.Error(e.message ?: "Failed to submit maintenance ticket")
        }
    }

    override suspend fun getAttachments(ticketId: String): AttachmentsResult {
        return try {
            val response = webApi.getMaintenanceTicketDocuments(ticketId)
            val body = response.body()
            if (!response.isSuccessful || body == null) {
                AttachmentsResult.Error("Failed to load attachments (${response.code()})")
            } else {
                AttachmentsResult.Loaded(body.documents.map { it.toTenantDocument() })
            }
        } catch (e: Exception) {
            AttachmentsResult.Error(e.message ?: "Failed to load attachments — check your connection.")
        }
    }

    override suspend fun uploadAttachment(ticketId: String, fileUri: Uri): AttachmentUploadResult {
        return try {
            // Photos are resized and re-encoded to fit the upload scanner (UploadImagePolicy); the
            // prepared cache file is deleted as soon as the upload call returns.
            val response = prepareUpload(context, fileUri, "maintenance_attachment").use { upload ->
                webApi.uploadMaintenanceTicketDocument(ticketId, upload.part)
            }
            val body = response.body()
            if (!response.isSuccessful || body == null) {
                AttachmentUploadResult.Error(
                    errorMessage(response) ?: "Failed to upload attachment (${response.code()})",
                )
            } else {
                AttachmentUploadResult.Success(body.document.toTenantDocument())
            }
        } catch (e: Exception) {
            AttachmentUploadResult.Error(e.message ?: "Failed to upload attachment — check your connection.")
        }
    }

    override suspend fun getAttachmentUrl(documentId: String): DocumentUrlResult {
        return try {
            val response = webApi.getDocument(documentId)
            if (!response.isSuccessful) {
                return DocumentUrlResult.Error(
                    errorMessage(response) ?: "Failed to open this attachment (${response.code()})",
                )
            }
            val body = response.body() ?: return DocumentUrlResult.Error("Failed to open this attachment.")
            DocumentUrlResult.Success(body.signedUrl, body.document.mimeType)
        } catch (e: Exception) {
            DocumentUrlResult.Error(e.message ?: "Failed to open this attachment — check your connection.")
        }
    }

    private suspend fun fallbackToCache(errorMessage: String): MaintenanceResult {
        val cached = dao.getAll()
        return if (cached.isNotEmpty()) {
            MaintenanceResult.Cached(cached.map { it.toDomain() }, cached.first().fetchedAtEpochMillis)
        } else {
            MaintenanceResult.Error(errorMessage)
        }
    }
}

private fun MaintenanceTicketDto.toDomain() = MaintenanceTicket(
    id = id,
    orgId = orgId,
    propertyId = propertyId,
    summary = summary,
    description = description,
    priority = priority,
    status = status,
    createdAt = createdAt,
)

private fun MaintenanceTicketDto.toEntity(fetchedAtEpochMillis: Long) = MaintenanceTicketEntity(
    id = id,
    orgId = orgId,
    propertyId = propertyId,
    summary = summary,
    description = description,
    priority = priority,
    status = status,
    createdAt = createdAt,
    fetchedAtEpochMillis = fetchedAtEpochMillis,
)

private fun MaintenanceTicketEntity.toDomain() = MaintenanceTicket(
    id = id,
    orgId = orgId,
    propertyId = propertyId,
    summary = summary,
    description = description,
    priority = priority,
    status = status,
    createdAt = createdAt,
)

private fun MaintenanceTicketCreatedDto.toDomain() = MaintenanceTicket(
    id = id,
    orgId = orgId,
    propertyId = propertyId,
    summary = summary,
    description = description,
    priority = priority,
    status = status,
    createdAt = createdAt,
)

private fun DocumentDto.toTenantDocument() = TenantDocument(
    id = id,
    originalFileName = originalFileName,
    mimeType = mimeType,
    documentType = documentType,
    createdAt = createdAt,
)
