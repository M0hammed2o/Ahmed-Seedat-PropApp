package za.co.proplyst.app.data.notificationprefs

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockNotificationPreferencesRepositoryTest {

    @Test
    fun `getMyPreferences returns one row per category, all channels enabled by default`() = runTest {
        val repository = MockNotificationPreferencesRepository()

        val result = repository.getMyPreferences()

        assertTrue(result is NotificationPreferencesResult.Loaded)
        val preferences = (result as NotificationPreferencesResult.Loaded).preferences
        assertEquals(NotificationCategory.entries.size, preferences.size)
        assertTrue(preferences.all { it.emailEnabled && it.pushEnabled && it.whatsappEnabled })
    }

    @Test
    fun `setChannelEnabled updates only the given category`() = runTest {
        val repository = MockNotificationPreferencesRepository()

        val result = repository.setChannelEnabled(
            category = NotificationCategory.MAINTENANCE,
            emailEnabled = false,
            pushEnabled = true,
            whatsappEnabled = false,
        )

        assertTrue(result is UpdatePreferenceResult.Success)
        val preferences = (repository.getMyPreferences() as NotificationPreferencesResult.Loaded).preferences
        val updated = preferences.first { it.category == NotificationCategory.MAINTENANCE }
        assertTrue(!updated.emailEnabled && updated.pushEnabled && !updated.whatsappEnabled)
        val untouched = preferences.first { it.category == NotificationCategory.RENT }
        assertTrue(untouched.emailEnabled && untouched.pushEnabled && untouched.whatsappEnabled)
    }
}
