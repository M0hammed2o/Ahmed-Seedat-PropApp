package com.propertyvault.app.data.maintenance

import kotlinx.coroutines.delay
import javax.inject.Inject

class MockMaintenanceRepository @Inject constructor() : MaintenanceRepository {

    private val fixture = listOf(
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
        return MaintenanceResult.Live(fixture)
    }

    override suspend fun getTicketById(id: String): MaintenanceTicket? {
        delay(200)
        return fixture.firstOrNull { it.id == id }
    }
}
