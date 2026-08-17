package za.co.proplyst.app.data.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class MaintenanceTicketDto(
    val id: String,
    @SerialName("org_id") val orgId: String,
    @SerialName("property_id") val propertyId: String,
    val summary: String,
    val description: String? = null,
    val priority: String,
    val status: String,
    @SerialName("created_at") val createdAt: String,
)

/** Tenant-submitted ticket creation (Android V1 final gap-closure pass, WORKLOG.md this date,
 * Phase 4) -- POST api/v1/tenant-portal/maintenance-tickets. org/property/unit/lease/tenant
 * context is derived server-side from the caller's own active lease, never sent from the client,
 * matching tenantMaintenanceTicketCreateSchema (packages/validation/src/operations.ts) exactly:
 * summary/description/priority only. */
@Serializable
data class CreateTenantMaintenanceTicketRequest(
    val summary: String,
    val description: String? = null,
    val priority: String,
)

/** The web API returns its own mapMaintenanceTicketRow() shape (camelCase, more fields than the
 * PostgREST row this app reads elsewhere) -- only the fields this app's MaintenanceTicket domain
 * model actually uses are declared here. */
@Serializable
data class MaintenanceTicketCreatedDto(
    val id: String,
    val orgId: String,
    val propertyId: String,
    val summary: String,
    val description: String? = null,
    val priority: String,
    val status: String,
    val createdAt: String,
)

@Serializable
data class MaintenanceTicketCreateResponse(
    val maintenanceTicket: MaintenanceTicketCreatedDto,
)

/** POST api/v1/tenant-portal/maintenance-tickets/{id}/documents (Android V1 last local blocker
 * pass, WORKLOG.md this date). Reuses DocumentDto (PaymentReportDto.kt) -- the wire shape is
 * identical to every other document response in this app, not a new one. */
@Serializable
data class MaintenanceDocumentUploadResponse(
    val document: DocumentDto,
)
