package za.co.proplyst.app.data.properties

// Domain model -- mirrors packages/types/src/property.ts's Property interface, decoupled from
// PropertyDto's wire shape so the UI layer never depends on network-layer types directly.
data class Property(
    val id: String,
    val orgId: String,
    val nickname: String,
    val fullAddress: String,
    val city: String,
    val province: String?,
    val propertyType: String,
    val municipalAccountNumber: String?,
    val notes: String?,
    val status: String,
)
