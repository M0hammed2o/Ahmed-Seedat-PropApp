package za.co.proplyst.app.data.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class TenantDto(
    val id: String,
    @SerialName("org_id") val orgId: String,
    @SerialName("full_name") val fullName: String,
    val email: String? = null,
    val phone: String? = null,
    val status: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
)
