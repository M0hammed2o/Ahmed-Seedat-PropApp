package za.co.proplyst.app.data.maintenance

import android.net.Uri
import za.co.proplyst.app.data.documents.DocumentUrlResult
import za.co.proplyst.app.data.documents.TenantDocument
import kotlinx.coroutines.delay
import javax.inject.Inject

class MockMaintenanceRepository @Inject constructor() : MaintenanceRepository {

    private val fixture = mutableListOf(
        MaintenanceTicket(
            id = "demo-ticket-1",
            orgId = "demo-org-1",
            propertyId = "demo-property-1",
            summary = "Kitchen tap leaking",
            description = "Slow drip under the kitchen sink, getting worse.",
            priority = "medium",
            status = "to_do",
            createdAt = "2026-07-28T00:00:00Z",
        ),
    )

    private val attachments = mutableMapOf(
        "demo-ticket-1" to mutableListOf(
            TenantDocument(
                id = "demo-attachment-1",
                originalFileName = "leaking_tap.jpg",
                mimeType = "image/jpeg",
                documentType = "supporting_document",
                createdAt = "2026-07-28T00:05:00Z",
            ),
        ),
    )

    override suspend fun getTickets(): MaintenanceResult {
        delay(400)
        return MaintenanceResult.Live(fixture.toList())
    }

    override suspend fun getTicketById(id: String): MaintenanceTicket? {
        delay(200)
        return fixture.firstOrNull { it.id == id }
    }

    override suspend fun createTicket(
        summary: String,
        description: String?,
        priority: String,
    ): CreateMaintenanceTicketResult {
        delay(300)
        if (summary.isBlank()) return CreateMaintenanceTicketResult.Error("Summary is required.")
        val ticket = MaintenanceTicket(
            id = "demo-ticket-${fixture.size + 1}",
            orgId = "demo-org-1",
            propertyId = "demo-property-1",
            summary = summary,
            description = description,
            priority = priority,
            status = "to_do",
            createdAt = "2026-08-17T00:00:00Z",
        )
        fixture.add(0, ticket)
        return CreateMaintenanceTicketResult.Success(ticket)
    }

    override suspend fun getAttachments(ticketId: String): AttachmentsResult {
        delay(300)
        return AttachmentsResult.Loaded(attachments[ticketId].orEmpty())
    }

    override suspend fun uploadAttachment(ticketId: String, fileUri: Uri): AttachmentUploadResult {
        delay(500)
        if (fixture.none { it.id == ticketId }) {
            return AttachmentUploadResult.Error("Maintenance ticket not found.")
        }
        val list = attachments.getOrPut(ticketId) { mutableListOf() }
        val document = TenantDocument(
            id = "demo-attachment-${list.size + 1}",
            originalFileName = "attachment_${list.size + 1}.jpg",
            mimeType = "image/jpeg",
            documentType = "supporting_document",
            createdAt = "2026-08-18T00:00:00Z",
        )
        list.add(document)
        return AttachmentUploadResult.Success(document)
    }

    override suspend fun getAttachmentUrl(documentId: String): DocumentUrlResult {
        delay(200)
        return DocumentUrlResult.Success(
            signedUrl = "https://example.test/demo-attachment.jpg",
            mimeType = "image/jpeg",
        )
    }
}
