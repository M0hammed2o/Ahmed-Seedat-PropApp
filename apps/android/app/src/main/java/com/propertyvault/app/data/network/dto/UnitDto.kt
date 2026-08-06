package com.propertyvault.app.data.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Mirrors packages/types/src/portfolio.ts's Unit interface field-for-field, same convention as
// PropertyDto.
@Serializable
data class UnitDto(
    val id: String,
    @SerialName("property_id") val propertyId: String,
    @SerialName("org_id") val orgId: String,
    @SerialName("unit_label") val unitLabel: String,
    val bedrooms: Int? = null,
    val bathrooms: Int? = null,
    @SerialName("size_sqm") val sizeSqm: Double? = null,
    @SerialName("market_rent") val marketRent: Double? = null,
    val status: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
)
