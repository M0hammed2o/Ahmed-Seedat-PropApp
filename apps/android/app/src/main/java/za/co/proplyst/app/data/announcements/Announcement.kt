package za.co.proplyst.app.data.announcements

/** Android V1 final gap-closure pass (WORKLOG.md this date), Phase 6. RLS
 * (`announcements_select_org_or_tenant`, migration 20260101000039) scopes a tenant caller to
 * portfolio-wide announcements plus ones scoped to a property they actually lease. Read/unread
 * tracking is deliberately NOT built for announcements that don't require acknowledgement: the
 * shared list endpoint (mapAnnouncementRow()) has no per-caller read-status join, and no tenant-
 * facing web UI exists yet to establish the expected shape for one -- a disclosed, "where
 * supported" simplification (this pass's own instruction), not an oversight. Acknowledgement
 * IS tracked (acknowledge() below), since a dedicated endpoint already exists for it. */
data class Announcement(
    val id: String,
    val title: String,
    val body: String,
    val propertyId: String?,
    val requiresAcknowledgement: Boolean,
    val publishedAt: String,
    val expiresAt: String?,
)

sealed interface AnnouncementsResult {
    data class Loaded(val announcements: List<Announcement>) : AnnouncementsResult
    data class Error(val message: String) : AnnouncementsResult
}

sealed interface AcknowledgeResult {
    data object Success : AcknowledgeResult
    data class Error(val message: String) : AcknowledgeResult
}

interface AnnouncementsRepository {
    suspend fun getMyAnnouncements(): AnnouncementsResult
    suspend fun acknowledge(id: String): AcknowledgeResult
}
