package com.propertyvault.app.data.properties

/** Result of a repository read that may be serving stale data -- NATIVE_ANDROID_SPEC.md §7's
 * "cached-data banner" requirement: the UI must know whether what it's showing is live or stale,
 * never presenting cached data as live silently. */
sealed interface PropertiesResult {
    data class Live(val properties: List<Property>) : PropertiesResult
    data class Cached(val properties: List<Property>, val fetchedAtEpochMillis: Long) : PropertiesResult
    data class Error(val message: String) : PropertiesResult
}

/**
 * Repository interface -- one real implementation (PostgrestPropertiesRepository, backed by the
 * live API) and one mock implementation (MockPropertiesRepository, deterministic fixture data),
 * never mixed (Mohammed's explicit instruction). Hilt binds exactly one of these per build --
 * see di/RepositoryModule.kt.
 */
interface PropertiesRepository {
    suspend fun getProperties(): PropertiesResult
    suspend fun getPropertyById(id: String): Property?
}
