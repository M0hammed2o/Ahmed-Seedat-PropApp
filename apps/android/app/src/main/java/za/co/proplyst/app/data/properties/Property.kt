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
    // Proplyst Mobile Design System redesign pass -- card-visual extras, merged in best-effort by
    // PostgrestPropertiesRepository from the JSON API (apps/admin/lib/propertyPhotos.ts,
    // unitOccupancy.ts). Defaulted so every existing call site (Mock repository, Room entity
    // mapping) keeps compiling unchanged; a property with no photo/occupancy data simply renders
    // its fallback state.
    val coverPhotoUrl: String? = null,
    val unitCount: Int = 0,
    val occupiedUnitCount: Int = 0,
)
