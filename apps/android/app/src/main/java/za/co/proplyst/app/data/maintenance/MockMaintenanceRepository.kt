package za.co.proplyst.app.data.maintenance

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
}
