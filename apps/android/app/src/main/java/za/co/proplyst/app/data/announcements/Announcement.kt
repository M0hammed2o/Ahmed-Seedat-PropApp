package za.co.proplyst.app.data.announcements

/** Android V1 final gap-closure pass (WORKLOG.md this date), Phase 6; read/unread tracking added
 * in the following last-local-blocker pass. RLS (`announcements_select_org_or_tenant`, migration
 * 20260101000039) scopes a tenant caller to portfolio-wide announcements plus ones scoped to a
 * property they actually lease.
 *
 * Read tracking reuses `announcement_reads` directly via PostgREST (`readAt`/`acknowledgedAt`
 * below) -- a real, already-existing per-user read-state table with its own tenant-self RLS
 * policy (`announcement_reads_select_org_or_self`, same migration), read with NO filter needed:
 * RLS alone already scopes the result to exactly the caller's own rows. The prior pass's read
 * "where supported" gap was a stale assessment -- the mechanism existed the whole time, this
 * pass just wires it, not a new persistence model. Writing a read receipt still only has one
 * real endpoint (`POST .../acknowledge`, which sets read_at and acknowledged_at together
 * server-side regardless of requiresAcknowledgement) -- an announcement that doesn't require
 * acknowledgement is marked read by calling that SAME endpoint when the tenant views it, just
 * without surfacing an "Acknowledge" button for it (see AnnouncementsListScreen). */
data class Announcement(
    val id: String,
    val title: String,
    val body: String,
    val propertyId: String?,
    val requiresAcknowledgement: Boolean,
    val publishedAt: String,
    val expiresAt: String?,
    val readAt: String?,
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
