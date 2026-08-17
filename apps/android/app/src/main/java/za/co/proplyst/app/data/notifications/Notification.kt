package za.co.proplyst.app.data.notifications

/** Mirrors `notifications` (migration 20260101000039) -- Android V1 final gap-closure pass
 * (WORKLOG.md this date), Phase 7. In-app notification centre only; OS push (FCM) is a separate,
 * genuinely external undertaking documented, not built, this pass -- see the final report. */
data class AppNotification(
    val id: String,
    val type: String,
    val title: String,
    val body: String?,
    val relatedEntityType: String?,
    val relatedEntityId: String?,
    val readAt: String?,
    val createdAt: String,
)

sealed interface NotificationsResult {
    data class Loaded(val notifications: List<AppNotification>) : NotificationsResult
    data class Error(val message: String) : NotificationsResult
}

sealed interface MarkReadResult {
    data object Success : MarkReadResult
    data class Error(val message: String) : MarkReadResult
}

interface NotificationsRepository {
    suspend fun getMyNotifications(): NotificationsResult
    suspend fun markRead(id: String): MarkReadResult
}
