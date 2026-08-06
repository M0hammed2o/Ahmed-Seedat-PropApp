package com.propertyvault.app.data.maintenance

sealed interface MaintenanceResult {
    data class Live(val tickets: List<MaintenanceTicket>) : MaintenanceResult
    data class Cached(val tickets: List<MaintenanceTicket>, val fetchedAtEpochMillis: Long) : MaintenanceResult
    data class Error(val message: String) : MaintenanceResult
}

/** Org-wide read, same shape as TenantsRepository -- matches apps/admin's own /maintenance board.
 * Read-only for now (getTickets/getTicketById); no createTicket() yet -- see MaintenanceTicket.kt's
 * doc comment for why submission isn't wired up in this pass. */
interface MaintenanceRepository {
    suspend fun getTickets(): MaintenanceResult
    suspend fun getTicketById(id: String): MaintenanceTicket?
}
