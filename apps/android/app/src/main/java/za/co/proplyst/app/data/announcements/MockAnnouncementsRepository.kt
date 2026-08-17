package za.co.proplyst.app.data.announcements

import kotlinx.coroutines.delay
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MockAnnouncementsRepository @Inject constructor() : AnnouncementsRepository {

    private val announcements = mutableListOf(
        Announcement(
            id = "demo-announcement-1",
            title = "Water shutoff this Friday",
            body = "The municipality is doing scheduled maintenance from 9am-2pm this Friday.",
            propertyId = "demo-property-1",
            requiresAcknowledgement = false,
            publishedAt = "2026-08-14T08:00:00Z",
            expiresAt = "2026-08-22T00:00:00Z",
        ),
        Announcement(
            id = "demo-announcement-2",
            title = "Updated house rules — please acknowledge",
            body = "We've updated the parking policy. Please read and acknowledge before 1 September.",
            propertyId = "demo-property-1",
            requiresAcknowledgement = true,
            publishedAt = "2026-08-10T08:00:00Z",
            expiresAt = null,
        ),
    )

    override suspend fun getMyAnnouncements(): AnnouncementsResult {
        delay(300)
        return AnnouncementsResult.Loaded(announcements.toList())
    }

    override suspend fun acknowledge(id: String): AcknowledgeResult {
        delay(200)
        if (announcements.none { it.id == id }) return AcknowledgeResult.Error("Announcement not found.")
        return AcknowledgeResult.Success
    }
}
