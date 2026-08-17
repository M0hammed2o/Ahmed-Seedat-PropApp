package za.co.proplyst.app.data.announcements

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockAnnouncementsRepositoryTest {

    @Test
    fun `getMyAnnouncements returns the fixture as Loaded`() = runTest {
        val repository = MockAnnouncementsRepository()

        val result = repository.getMyAnnouncements()

        assertTrue(result is AnnouncementsResult.Loaded)
        assertEquals(2, (result as AnnouncementsResult.Loaded).announcements.size)
    }

    @Test
    fun `acknowledge succeeds for a known announcement`() = runTest {
        val repository = MockAnnouncementsRepository()

        val result = repository.acknowledge("demo-announcement-2")

        assertTrue(result is AcknowledgeResult.Success)
    }

    @Test
    fun `acknowledge errors for an unknown announcement`() = runTest {
        val repository = MockAnnouncementsRepository()

        val result = repository.acknowledge("does-not-exist")

        assertTrue(result is AcknowledgeResult.Error)
    }

    @Test
    fun `acknowledge persists readAt on the matching fixture`() = runTest {
        val repository = MockAnnouncementsRepository()

        repository.acknowledge("demo-announcement-2")

        val updated = (repository.getMyAnnouncements() as AnnouncementsResult.Loaded).announcements
            .first { it.id == "demo-announcement-2" }
        assertEquals("2026-08-18T00:00:00Z", updated.readAt)
    }
}
