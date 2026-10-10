package za.co.proplyst.app.data.network.dto

import kotlinx.serialization.Serializable

/** GET api/v1/tenant-portal/utility-statements -- the caller's approved utility statements (hybrid utilities,
 * migration 178). RLS only exposes approved/sent statements of the caller's own leases; drafts never arrive. */
@Serializable
data class UtilityStatementLineDto(
    val utility: String,
    val description: String,
    val segment: String,
    val opening: Double? = null,
    val closing: Double? = null,
    val consumption: Double? = null,
    val unit: String,
    val basis: String,
    val tariff: String? = null,
    val total: Double,
    val creditApplied: Double = 0.0,
)

@Serializable
data class UtilityStatementDto(
    val id: String,
    val propertyId: String,
    val propertyName: String? = null,
    val unitLabel: String? = null,
    val periodStart: String,
    val periodEnd: String,
    val status: String,
    val total: Double,
    val vat: Double? = null,
    val lines: List<UtilityStatementLineDto> = emptyList(),
    val notes: List<String> = emptyList(),
)

@Serializable
data class UtilityStatementListResponse(val statements: List<UtilityStatementDto>)
