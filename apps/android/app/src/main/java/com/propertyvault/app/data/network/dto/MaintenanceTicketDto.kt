package com.propertyvault.app.data.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class MaintenanceTicketDto(
    val id: String,
    @SerialName("org_id") val orgId: String,
    @SerialName("property_id") val propertyId: String,
    val summary: String,
    val description: String? = null,
    val priority: String,
    val status: String,
    @SerialName("created_at") val createdAt: String,
)
