package za.co.proplyst.app.data.notifications

import za.co.proplyst.app.data.network.PostgrestApi
import za.co.proplyst.app.data.network.dto.NotificationDto
import za.co.proplyst.app.data.network.dto.NotificationDismissUpdate
import za.co.proplyst.app.data.network.dto.NotificationReadUpdate
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PostgrestNotificationsRepository @Inject constructor(
    private val api: PostgrestApi,
) : NotificationsRepository {

    override suspend fun getMyNotifications(): NotificationsResult {
        return try {
            val response = api.getMyNotifications()
            if (!response.isSuccessful) return NotificationsResult.Error("Failed to load notifications.")
            // Dismissed entries are filtered here rather than in the query, so the app keeps working
            // against a backend that does not have the dismissed_at column yet (2026-09-17).
            NotificationsResult.Loaded(
                response.body().orEmpty().filter { it.dismissedAt == null }.map { it.toDomain() },
            )
        } catch (e: Exception) {
            NotificationsResult.Error(e.message ?: "Failed to load notifications — check your connection.")
        }
    }

    override suspend fun markRead(id: String): MarkReadResult {
        return try {
            val response = api.markNotificationRead(
                idFilter = "eq.$id",
                body = NotificationReadUpdate(readAt = Instant.now().toString()),
            )
            if (!response.isSuccessful) return MarkReadResult.Error("Failed to mark this notification read.")
            MarkReadResult.Success
        } catch (e: Exception) {
            MarkReadResult.Error(e.message ?: "Failed to mark read — check your connection.")
        }
    }

    override suspend fun dismiss(id: String): MarkReadResult {
        return try {
            val response = api.dismissNotification(
                idFilter = "eq.$id",
                body = NotificationDismissUpdate(dismissedAt = Instant.now().toString()),
            )
            if (!response.isSuccessful) return MarkReadResult.Error("Failed to dismiss this activity item.")
            MarkReadResult.Success
        } catch (e: Exception) {
            MarkReadResult.Error(e.message ?: "Failed to dismiss — check your connection.")
        }
    }

    private fun NotificationDto.toDomain() = AppNotification(
        id = id,
        type = type,
        title = title,
        body = body,
        relatedEntityType = relatedEntityType,
        relatedEntityId = relatedEntityId,
        readAt = readAt,
        createdAt = createdAt,
    )
}
