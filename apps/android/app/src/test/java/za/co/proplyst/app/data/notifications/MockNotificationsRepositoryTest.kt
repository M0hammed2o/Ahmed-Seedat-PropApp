package za.co.proplyst.app.data.notifications

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MockNotificationsRepositoryTest {

    @Test
    fun `getMyNotifications returns the fixture as Loaded`() = runTest {
        val repository = MockNotificationsRepository()

        val result = repository.getMyNotifications()

        assertTrue(result is NotificationsResult.Loaded)
        assertEquals(2, (result as NotificationsResult.Loaded).notifications.size)
    }

    @Test
    fun `markRead sets readAt on the matching notification`() = runTest {
        val repository = MockNotificationsRepository()

        val result = repository.markRead("demo-notification-1")

        assertTrue(result is MarkReadResult.Success)
        val updated = (repository.getMyNotifications() as NotificationsResult.Loaded).notifications
            .first { it.id == "demo-notification-1" }
        assertNotNull(updated.readAt)
    }

    @Test
    fun `markRead errors for an unknown id`() = runTest {
        val repository = MockNotificationsRepository()

        val result = repository.markRead("does-not-exist")

        assertTrue(result is MarkReadResult.Error)
    }

    @Test
    fun `unread notification starts with a null readAt`() = runTest {
        val repository = MockNotificationsRepository()

        val notification = (repository.getMyNotifications() as NotificationsResult.Loaded).notifications
            .first { it.id == "demo-notification-1" }

        assertNull(notification.readAt)
    }
}
