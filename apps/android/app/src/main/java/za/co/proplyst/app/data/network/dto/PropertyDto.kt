package za.co.proplyst.app.data.network.dto

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

/** "My Lease" (Invoice V1 completion pass, WORKLOG.md this date) -- a richer embed of the SAME
 * `tenants` row `getMyTenancies()` above reads, via PostgREST's own embed syntax
 * (`lease_tenants(lease_id,leases(...))`), mirroring `resolveTenantSession()`'s own query shape
 * (apps/admin/lib/tenantSession.ts) conceptually. A separate call from the lightweight
 * `getMyTenancies()` above -- that one runs on every sign-in/session-restore and stays cheap on
 * purpose; this one only runs when the tenant actually opens "My Lease." RLS
 * (`tenants_select_org_or_self`/`leases_select_org_or_tenant`/`units_select_org_or_tenant`/
 * `properties_select_org_or_tenant`) scopes every embedded table to the caller's own rows, same
 * as every other "my own" read in this app. */
@Serializable
data class TenancyWithLeaseDto(
    val id: String,
    @SerialName("org_id") val orgId: String,
    val status: String,
    @SerialName("lease_tenants") val leaseTenants: List<LeaseTenantEmbedDto> = emptyList(),
)

@Serializable
data class LeaseTenantEmbedDto(
    @SerialName("lease_id") val leaseId: String,
    val leases: LeaseEmbedDto? = null,
)

@Serializable
data class LeaseEmbedDto(
    val id: String,
    val status: String,
    @SerialName("start_date") val startDate: String,
    @SerialName("end_date") val endDate: String? = null,
    @SerialName("rent_amount") val rentAmount: Double,
    @SerialName("unit_id") val unitId: String,
    val units: UnitEmbedDto? = null,
)

@Serializable
data class UnitEmbedDto(
    val id: String,
    @SerialName("unit_label") val unitLabel: String,
    @SerialName("property_id") val propertyId: String,
    val properties: PropertyEmbedDto? = null,
)

@Serializable
data class PropertyEmbedDto(
    val id: String,
    val nickname: String,
    @SerialName("full_address") val fullAddress: String,
)
