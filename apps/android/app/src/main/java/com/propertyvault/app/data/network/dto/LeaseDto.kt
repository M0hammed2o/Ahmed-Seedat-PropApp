package com.propertyvault.app.data.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class LeaseDto(
    val id: String,
    @SerialName("org_id") val orgId: String,
    @SerialName("unit_id") val unitId: String,
    @SerialName("start_date") val startDate: String,
    @SerialName("end_date") val endDate: String? = null,
    @SerialName("rent_amount") val rentAmount: Double,
    @SerialName("rent_frequency") val rentFrequency: String,
    @SerialName("deposit_amount") val depositAmount: Double,
    val status: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
)
