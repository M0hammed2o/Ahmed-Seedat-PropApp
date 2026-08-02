package com.propertyvault.app.data.maintenance

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
}
