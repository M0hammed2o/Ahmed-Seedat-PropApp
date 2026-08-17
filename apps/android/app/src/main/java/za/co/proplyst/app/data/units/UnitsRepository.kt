package za.co.proplyst.app.data.units

/** Same cached-vs-live contract as PropertiesResult (NATIVE_ANDROID_SPEC.md §7) -- one sealed
 * result type per repository rather than a shared generic, matching PropertiesRepository's own
 * precedent (kept simple and explicit over a premature generic abstraction). */
sealed interface UnitsResult {
    data class Live(val units: List<PropertyUnit>) : UnitsResult
    data class Cached(val units: List<PropertyUnit>, val fetchedAtEpochMillis: Long) : UnitsResult
    data class Error(val message: String) : UnitsResult
}

/**
 * Units are always viewed in a property's context (no org-wide units tab in this native V1 slice
 * -- MOBILE_ARCHITECTURE_DECISION.md §6 lists Units as view-only), so the list read takes a
 * propertyId rather than loading everything for the org. One real (PostgrestUnitsRepository) and
 * one mock (MockUnitsRepository) implementation, never mixed -- same rule as PropertiesRepository.
 */
interface UnitsRepository {
    suspend fun getUnitsByProperty(propertyId: String): UnitsResult
    suspend fun getUnitById(id: String): PropertyUnit?
}
