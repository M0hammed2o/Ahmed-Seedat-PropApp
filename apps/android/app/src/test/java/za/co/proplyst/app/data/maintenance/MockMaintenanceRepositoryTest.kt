package za.co.proplyst.app.data.maintenance

import android.net.Uri
import za.co.proplyst.app.data.documents.DocumentUrlResult
import io.mockk.mockk
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

    @Test
    fun `getAttachments returns the fixture attachment for the demo ticket`() = runTest {
        val repository = MockMaintenanceRepository()

        val result = repository.getAttachments("demo-ticket-1")

        assertTrue(result is AttachmentsResult.Loaded)
        assertEquals(1, (result as AttachmentsResult.Loaded).documents.size)
    }

    @Test
    fun `getAttachments returns empty for a ticket with none`() = runTest {
        val repository = MockMaintenanceRepository()

        val result = repository.getAttachments("does-not-exist")

        assertTrue(result is AttachmentsResult.Loaded)
        assertTrue((result as AttachmentsResult.Loaded).documents.isEmpty())
    }

    @Test
    fun `uploadAttachment adds a new attachment for an existing ticket`() = runTest {
        val repository = MockMaintenanceRepository()
        val uri = mockk<Uri>()

        val result = repository.uploadAttachment("demo-ticket-1", uri)

        assertTrue(result is AttachmentUploadResult.Success)
        val attachments = (repository.getAttachments("demo-ticket-1") as AttachmentsResult.Loaded).documents
        assertEquals(2, attachments.size)
    }

    @Test
    fun `uploadAttachment errors for an unknown ticket`() = runTest {
        val repository = MockMaintenanceRepository()
        val uri = mockk<Uri>()

        val result = repository.uploadAttachment("does-not-exist", uri)

        assertTrue(result is AttachmentUploadResult.Error)
    }

    @Test
    fun `getAttachmentUrl returns a signed url`() = runTest {
        val repository = MockMaintenanceRepository()

        val result = repository.getAttachmentUrl("demo-attachment-1")

        assertTrue(result is DocumentUrlResult.Success)
    }
}
