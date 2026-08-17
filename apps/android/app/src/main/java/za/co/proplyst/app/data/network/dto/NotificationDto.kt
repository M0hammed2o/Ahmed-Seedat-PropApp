package za.co.proplyst.app.data.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Mirrors `notifications` (migration 20260101000039), direct PostgREST, RLS
 * (`notifications_select_own`/`notifications_update_own`). Android V1 final gap-closure pass
 * (WORKLOG.md this date), Phase 7. */
@Serializable
data class NotificationDto(
    val id: String,
    val type: String,
    val title: String,
    val body: String? = null,
    @SerialName("related_entity_type") val relatedEntityType: String? = null,
    @SerialName("related_entity_id") val relatedEntityId: String? = null,
    @SerialName("read_at") val readAt: String? = null,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
data class NotificationReadUpdate(@SerialName("read_at") val readAt: String)

/** Mirrors `notification_preferences` (same migration), RLS `notification_preferences_all_own`
 * (the caller can read/write their own rows directly -- no web-API layer needed). Phase 9. */
@Serializable
data class NotificationPreferenceDto(
    val category: String,
    @SerialName("email_enabled") val emailEnabled: Boolean = true,
    @SerialName("push_enabled") val pushEnabled: Boolean = true,
    @SerialName("whatsapp_enabled") val whatsappEnabled: Boolean = true,
    @SerialName("preferred_summary_day") val preferredSummaryDay: Int? = null,
)

@Serializable
data class NotificationPreferenceUpsert(
    @SerialName("user_id") val userId: String,
    val category: String,
    @SerialName("email_enabled") val emailEnabled: Boolean,
    @SerialName("push_enabled") val pushEnabled: Boolean,
    @SerialName("whatsapp_enabled") val whatsappEnabled: Boolean,
)
