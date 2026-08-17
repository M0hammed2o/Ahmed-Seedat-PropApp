package za.co.proplyst.app.data.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Mirrors owner_property_summaries (migration 20260101000107) column-for-column -- a direct
 * PostgREST read, RLS-scoped (owner_property_summaries_select_owner_self), no server-side
 * business logic involved, unlike PaymentReportDto's web-API DTOs. Android V1 final gap-closure
 * pass (WORKLOG.md this date), Phase 8. */
@Serializable
data class OwnerSummaryDto(
    val id: String,
    @SerialName("period_start") val periodStart: String,
    @SerialName("period_end") val periodEnd: String,
    @SerialName("property_count") val propertyCount: Int,
    @SerialName("expected_rent") val expectedRent: Double,
    @SerialName("confirmed_paid") val confirmedPaid: Double,
    val outstanding: Double,
    @SerialName("awaiting_confirmation") val awaitingConfirmation: Double,
    @SerialName("open_maintenance_count") val openMaintenanceCount: Int,
    @SerialName("upcoming_lease_expiry_count") val upcomingLeaseExpiryCount: Int,
    @SerialName("sent_at") val sentAt: String? = null,
)
