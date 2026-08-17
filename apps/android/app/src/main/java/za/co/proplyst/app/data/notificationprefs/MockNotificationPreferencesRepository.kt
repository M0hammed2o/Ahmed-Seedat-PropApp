package za.co.proplyst.app.data.notificationprefs

import kotlinx.coroutines.delay
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MockNotificationPreferencesRepository @Inject constructor() : NotificationPreferencesRepository {

    private val preferences = NotificationCategory.entries.associateWith {
        NotificationPreference(it, emailEnabled = true, pushEnabled = true, whatsappEnabled = true)
    }.toMutableMap()

    override suspend fun getMyPreferences(): NotificationPreferencesResult {
        delay(250)
        return NotificationPreferencesResult.Loaded(NotificationCategory.entries.map { preferences.getValue(it) })
    }

    override suspend fun setChannelEnabled(
        category: NotificationCategory,
        emailEnabled: Boolean,
        pushEnabled: Boolean,
        whatsappEnabled: Boolean,
    ): UpdatePreferenceResult {
        delay(150)
        preferences[category] = NotificationPreference(category, emailEnabled, pushEnabled, whatsappEnabled)
        return UpdatePreferenceResult.Success
    }
}
