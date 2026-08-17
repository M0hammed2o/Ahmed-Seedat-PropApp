package com.propertyvault.app.data.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Mirrors packages/types/src/property.ts's Property interface field-for-field (snake_case wire
// format, matching Postgrest's column-name-as-JSON-key convention) -- same validation rules
// conceptually as propertySchema (packages/validation/src/property.ts): nickname/addressLine1/
// city/propertyType required, the rest optional. Server remains the authority
// (API_SPEC.md §10); this DTO is the wire shape, not a second source of truth for what's valid.
@Serializable
data class PropertyDto(
    val id: String,
    @SerialName("org_id") val orgId: String,
    val nickname: String,
    @SerialName("full_address") val fullAddress: String,
    @SerialName("address_line1") val addressLine1: String,
    @SerialName("address_line2") val addressLine2: String? = null,
    val suburb: String? = null,
    val city: String,
    val province: String? = null,
    @SerialName("postal_code") val postalCode: String? = null,
    val country: String,
    @SerialName("property_type") val propertyType: String,
    @SerialName("municipal_account_number") val municipalAccountNumber: String? = null,
    val notes: String? = null,
    @SerialName("image_path") val imagePath: String? = null,
    val status: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
)

@Serializable
data class OrganizationMemberDto(
    @SerialName("org_id") val orgId: String,
    val role: String,
    val status: String,
)

/** Android V1 commercial-launch pass (WORKLOG.md this date) -- the tenant-portal equivalent of
 * OrganizationMemberDto, used only to detect "does this signed-in user hold a tenancy" during
 * sign-in/session-restore role routing. */
@Serializable
data class TenancyMembershipDto(
    val id: String,
    @SerialName("org_id") val orgId: String,
    val status: String,
)
