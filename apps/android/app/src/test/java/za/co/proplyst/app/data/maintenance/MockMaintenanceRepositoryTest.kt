package za.co.proplyst.app.data.maintenance

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockMaintenanceRepositoryTest {

    @Test
    fun `getTickets returns the fixture as Live data`() = runTest {
        val repository = MockMaintenanceRepository()

        val result = repository.getTickets()

        assertTrue(result is MaintenanceResult.Live)
        val live = result as MaintenanceResult.Live
        assertEquals(1, live.tickets.size)
        assertEquals("Kitchen tap leaking", live.tickets.first().summary)
    }

    @Test
    fun `getTicketById returns the matching fixture ticket`() = runTest {
        val repository = MockMaintenanceRepository()

        val ticket = repository.getTicketById("demo-ticket-1")

        assertEquals("Kitchen tap leaking", ticket?.summary)
    }

    @Test
    fun `getTicketById returns null for an unknown id`() = runTest {
        val repository = MockMaintenanceRepository()

        val ticket = repository.getTicketById("does-not-exist")

        assertEquals(null, ticket)
    }

    @Test
    fun `createTicket adds a new ticket starting in to_do status`() = runTest {
        val repository = MockMaintenanceRepository()

        val result = repository.createTicket(summary = "Broken window latch", description = "Won't lock.", priority = "high")

        assertTrue(result is CreateMaintenanceTicketResult.Success)
        val ticket = (result as CreateMaintenanceTicketResult.Success).ticket
        assertEquals("to_do", ticket.status)
        assertEquals("high", ticket.priority)

        val listed = repository.getTickets() as MaintenanceResult.Live
        assertEquals(2, listed.tickets.size)
    }

    @Test
    fun `createTicket rejects a blank summary without adding a ticket`() = runTest {
        val repository = MockMaintenanceRepository()

        val result = repository.createTicket(summary = "  ", description = null, priority = "medium")

        assertTrue(result is CreateMaintenanceTicketResult.Error)
        val listed = repository.getTickets() as MaintenanceResult.Live
        assertEquals(1, listed.tickets.size)
    }
}
