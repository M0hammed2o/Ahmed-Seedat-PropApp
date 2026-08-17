package za.co.proplyst.app.data.notificationprefs

import za.co.proplyst.app.data.auth.SessionManager
import za.co.proplyst.app.data.network.PostgrestApi
import za.co.proplyst.app.data.network.dto.NotificationPreferenceDto
import za.co.proplyst.app.data.network.dto.NotificationPreferenceUpsert
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PostgrestNotificationPreferencesRepository @Inject constructor(
    private val api: PostgrestApi,
    private val sessionManager: SessionManager,
) : NotificationPreferencesRepository {

    override suspend fun getMyPreferences(): NotificationPreferencesResult {
        return try {
            val response = api.getMyNotificationPreferences()
            if (!response.isSuccessful) {
                return NotificationPreferencesResult.Error("Failed to load notification settings.")
            }
            val byCategory = response.body().orEmpty().mapNotNull { it.toDomain() }
            // Missing row = every channel enabled -- the DB column defaults, not a guessed UI
            // default (mirrors NotificationPreferencesForm.tsx's own defaultsFor()).
            val allCategories = NotificationCategory.entries.map { category ->
                byCategory.find { it.category == category }
                    ?: NotificationPreference(category, emailEnabled = true, pushEnabled = true, whatsappEnabled = true)
            }
            NotificationPreferencesResult.Loaded(allCategories)
        } catch (e: Exception) {
            NotificationPreferencesResult.Error(e.message ?: "Failed to load settings — check your connection.")
        }
    }

    override suspend fun setChannelEnabled(
        category: NotificationCategory,
        emailEnabled: Boolean,
        pushEnabled: Boolean,
        whatsappEnabled: Boolean,
    ): UpdatePreferenceResult {
        val userId = sessionManager.getUserId() ?: return UpdatePreferenceResult.Error("Not signed in.")
        return try {
            val response = api.upsertNotificationPreference(
                NotificationPreferenceUpsert(
                    userId = userId,
                    category = category.wireValue,
                    emailEnabled = emailEnabled,
                    pushEnabled = pushEnabled,
                    whatsappEnabled = whatsappEnabled,
                ),
            )
            if (!response.isSuccessful) {
                return UpdatePreferenceResult.Error("Failed to save this setting.")
            }
            UpdatePreferenceResult.Success
        } catch (e: Exception) {
            UpdatePreferenceResult.Error(e.message ?: "Failed to save — check your connection.")
        }
    }

    private fun NotificationPreferenceDto.toDomain(): NotificationPreference? {
        val category = NotificationCategory.fromWireValue(category) ?: return null
        return NotificationPreference(category, emailEnabled, pushEnabled, whatsappEnabled)
    }
}
