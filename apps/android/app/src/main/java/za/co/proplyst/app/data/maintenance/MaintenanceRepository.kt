package za.co.proplyst.app.data.maintenance

import android.net.Uri
import za.co.proplyst.app.data.documents.DocumentUrlResult
import za.co.proplyst.app.data.documents.TenantDocument

sealed interface MaintenanceResult {
    data class Live(val tickets: List<MaintenanceTicket>) : MaintenanceResult
    data class Cached(val tickets: List<MaintenanceTicket>, val fetchedAtEpochMillis: Long) : MaintenanceResult
    data class Error(val message: String) : MaintenanceResult
}

sealed interface CreateMaintenanceTicketResult {
    data class Success(val ticket: MaintenanceTicket) : CreateMaintenanceTicketResult
    data class Error(val message: String) : CreateMaintenanceTicketResult
}

sealed interface AttachmentsResult {
    data class Loaded(val documents: List<TenantDocument>) : AttachmentsResult
    data class Error(val message: String) : AttachmentsResult
}

sealed interface AttachmentUploadResult {
    data class Success(val document: TenantDocument) : AttachmentUploadResult
    data class Error(val message: String) : AttachmentUploadResult
}

/** Shared between the owner/staff maintenance board (getTickets() returns every ticket RLS
 * scopes the caller to see -- org-wide for staff, own-only for a tenant caller via the
 * `maintenance_tickets_select_tenant_self` policy, migration 20260101000049) and the tenant
 * portal's own ticket submission (Android V1 final gap-closure pass, WORKLOG.md this date, Phase
 * 4 -- createTicket() reuses the same "one repository, RLS decides scope" pattern as payment
 * reports/review). Photo/file attachment (Android V1 last local blocker pass, WORKLOG.md this
 * date): reuses the existing `documents`/private-bucket infrastructure via
 * `POST api/v1/tenant-portal/maintenance-tickets/:id/documents` -- the uploaded document's
 * `lease_id` is set server-side to the ticket's own lease, which is the SAME existing mechanism
 * `documents_select_tenant_self` already uses to grant tenant read access, so getAttachments()
 * needs no new RLS policy either. Reuses TenantDocument (data.documents package) rather than a
 * second, duplicate "document" domain type. */
interface MaintenanceRepository {
    suspend fun getTickets(): MaintenanceResult
    suspend fun getTicketById(id: String): MaintenanceTicket?
    suspend fun createTicket(summary: String, description: String?, priority: String): CreateMaintenanceTicketResult
    suspend fun getAttachments(ticketId: String): AttachmentsResult
    suspend fun uploadAttachment(ticketId: String, fileUri: Uri): AttachmentUploadResult
    suspend fun getAttachmentUrl(documentId: String): DocumentUrlResult
}
