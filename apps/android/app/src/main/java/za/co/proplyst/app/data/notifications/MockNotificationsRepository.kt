package za.co.proplyst.app.data.notifications

import kotlinx.coroutines.delay
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MockNotificationsRepository @Inject constructor() : NotificationsRepository {

    private val notifications = mutableListOf(
        AppNotification(
            id = "demo-notification-1",
            type = "payment_report.confirmed",
            title = "Payment confirmed",
            body = "Your payment of R8,500.00 was confirmed.",
            relatedEntityType = "payment_report",
            relatedEntityId = "demo-payment-report-1",
            readAt = null,
            createdAt = "2026-08-16T10:00:00Z",
        ),
        AppNotification(
            id = "demo-notification-2",
            type = "maintenance_ticket.updated",
            title = "Maintenance update",
            body = "Your maintenance request is now in progress.",
            relatedEntityType = "maintenance_ticket",
            relatedEntityId = "demo-ticket-1",
            readAt = "2026-08-15T09:00:00Z",
            createdAt = "2026-08-15T08:30:00Z",
        ),
    )

    override suspend fun getMyNotifications(): NotificationsResult {
        delay(300)
        return NotificationsResult.Loaded(notifications.toList())
    }

    override suspend fun markRead(id: String): MarkReadResult {
        delay(150)
        val index = notifications.indexOfFirst { it.id == id }
        if (index < 0) return MarkReadResult.Error("Notification not found.")
        notifications[index] = notifications[index].copy(readAt = "2026-08-17T00:00:00Z")
        return MarkReadResult.Success
    }
}
