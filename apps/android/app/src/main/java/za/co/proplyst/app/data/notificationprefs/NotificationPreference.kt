package za.co.proplyst.app.data.notificationprefs

/** Mirrors the web app's own `NOTIFICATION_CATEGORIES` (packages/types/src/enums.ts) --
 * deliberately the SAME fixed set, not a separate Android-only preference model (Android V1
 * final gap-closure pass, WORKLOG.md this date, Phase 9). Human-readable labels only, matching
 * the web NotificationPreferencesForm's own "never a raw category token" rule. */
enum class NotificationCategory(val wireValue: String, val label: String) {
    RENT("rent", "Rent & payments"),
    MAINTENANCE("maintenance", "Maintenance"),
    LEASE("lease", "Lease"),
    INSPECTIONS("inspections", "Inspections"),
    ANNOUNCEMENTS("announcements", "Announcements"),
    SECURITY("security", "Security"),
    PROMOTIONAL("promotional", "Promotional"),
    OWNER_SUMMARY("owner_summary", "Monthly property summary");

    companion object {
        fun fromWireValue(value: String): NotificationCategory? = entries.find { it.wireValue == value }
    }
}

data class NotificationPreference(
    val category: NotificationCategory,
    val emailEnabled: Boolean,
    val pushEnabled: Boolean,
    val whatsappEnabled: Boolean,
)

sealed interface NotificationPreferencesResult {
    data class Loaded(val preferences: List<NotificationPreference>) : NotificationPreferencesResult
    data class Error(val message: String) : NotificationPreferencesResult
}

sealed interface UpdatePreferenceResult {
    data object Success : UpdatePreferenceResult
    data class Error(val message: String) : UpdatePreferenceResult
}

/** One real implementation (PostgrestNotificationPreferencesRepository) and one mock -- same
 * split every other repository in this app uses. Missing category = all channels enabled,
 * matching the DB column defaults exactly (email_enabled/push_enabled/whatsapp_enabled `not null
 * default true`), never a guessed UI default. */
interface NotificationPreferencesRepository {
    suspend fun getMyPreferences(): NotificationPreferencesResult
    suspend fun setChannelEnabled(
        category: NotificationCategory,
        emailEnabled: Boolean,
        pushEnabled: Boolean,
        whatsappEnabled: Boolean,
    ): UpdatePreferenceResult
}
