package za.co.proplyst.app.data.network.dto

import kotlinx.serialization.Serializable

/** GET api/v1/announcements (Android V1 final gap-closure pass, WORKLOG.md this date, Phase 6) --
 * the web API's own mapAnnouncementRow() shape (camelCase). RLS
 * (`announcements_select_org_or_tenant`) scopes a tenant caller to portfolio-wide announcements
 * plus ones scoped to a property they actually lease -- no filter[org_id]/filter[property_id]
 * sent, same as every other "my own" endpoint this app calls. */
@Serializable
data class AnnouncementDto(
    val id: String,
    val orgId: String,
    val propertyId: String? = null,
    val title: String,
    val body: String,
    val requiresAcknowledgement: Boolean,
    val publishedAt: String,
    val expiresAt: String? = null,
    val createdAt: String,
)

@Serializable
data class AnnouncementListResponse(val announcements: List<AnnouncementDto>)
