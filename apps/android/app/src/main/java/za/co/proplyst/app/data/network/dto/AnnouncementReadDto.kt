package za.co.proplyst.app.data.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** GET rest/v1/announcement_reads (Android V1 last local blocker pass, WORKLOG.md this date) --
 * RLS (`announcement_reads_select_org_or_self`) scopes this to the caller's own read receipts
 * with no filter needed. */
@Serializable
data class AnnouncementReadDto(
    @SerialName("announcement_id") val announcementId: String,
    @SerialName("read_at") val readAt: String? = null,
    @SerialName("acknowledged_at") val acknowledgedAt: String? = null,
)
