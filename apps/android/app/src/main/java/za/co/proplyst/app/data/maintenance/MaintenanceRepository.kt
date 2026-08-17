package za.co.proplyst.app.data.maintenance

sealed interface MaintenanceResult {
    data class Live(val tickets: List<MaintenanceTicket>) : MaintenanceResult
    data class Cached(val tickets: List<MaintenanceTicket>, val fetchedAtEpochMillis: Long) : MaintenanceResult
    data class Error(val message: String) : MaintenanceResult
}

sealed interface CreateMaintenanceTicketResult {
    data class Success(val ticket: MaintenanceTicket) : CreateMaintenanceTicketResult
    data class Error(val message: String) : CreateMaintenanceTicketResult
}

/** Shared between the owner/staff maintenance board (getTickets() returns every ticket RLS
 * scopes the caller to see -- org-wide for staff, own-only for a tenant caller via the
 * `maintenance_tickets_select_tenant_self` policy, migration 20260101000049) and the tenant
 * portal's own ticket submission (Android V1 final gap-closure pass, WORKLOG.md this date, Phase
 * 4 -- createTicket() reuses the same "one repository, RLS decides scope" pattern as payment
 * reports/review). Photo/file attachment is NOT implemented: the backend
 * tenantMaintenanceTicketCreateSchema (packages/validation/src/operations.ts) accepts only
 * summary/description/priority today -- no attachment field, no storage-upload endpoint for this
 * table exists yet. Attaching one securely (bucket policy, signed upload URL, virus/type
 * validation) is real backend design work, not something to bolt on client-side without it; this
 * is a disclosed, undelivered gap -- see this pass's final report. */
interface MaintenanceRepository {
    suspend fun getTickets(): MaintenanceResult
    suspend fun getTicketById(id: String): MaintenanceTicket?
    suspend fun createTicket(summary: String, description: String?, priority: String): CreateMaintenanceTicketResult
}
