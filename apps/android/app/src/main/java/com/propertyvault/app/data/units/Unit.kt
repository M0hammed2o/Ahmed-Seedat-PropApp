package com.propertyvault.app.data.units

// Domain model -- mirrors packages/types/src/portfolio.ts's Unit interface. Named PropertyUnit
// (not Unit) to avoid colliding with Kotlin's own `Unit` type across this file's own signatures.
data class PropertyUnit(
    val id: String,
    val propertyId: String,
    val orgId: String,
    val unitLabel: String,
    val bedrooms: Int?,
    val bathrooms: Int?,
    val sizeSqm: Double?,
    val marketRent: Double?,
    val status: String,
)
