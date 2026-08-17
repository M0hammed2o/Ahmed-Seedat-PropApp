package za.co.proplyst.app.data.leases

// Domain model -- mirrors packages/types/src/leasing.ts's Lease interface, minus source/
// sourceDocumentId/sourceApplicationId (internal provenance fields with no view-only-screen use
// yet, same reasoning as Tenant.idNumberRef being left out of the Tenants slice).
data class Lease(
    val id: String,
    val orgId: String,
    val unitId: String,
    val startDate: String,
    val endDate: String?,
    val rentAmount: Double,
    val rentFrequency: String,
    val depositAmount: Double,
    val status: String,
)
