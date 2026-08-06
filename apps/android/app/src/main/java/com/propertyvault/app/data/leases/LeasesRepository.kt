package com.propertyvault.app.data.leases

sealed interface LeasesResult {
    data class Live(val leases: List<Lease>) : LeasesResult
    data class Cached(val leases: List<Lease>, val fetchedAtEpochMillis: Long) : LeasesResult
    data class Error(val message: String) : LeasesResult
}

/** Unit-scoped, same shape as UnitsRepository being property-scoped -- a lease only ever makes
 * sense in the context of the unit it's for. */
interface LeasesRepository {
    suspend fun getLeasesByUnit(unitId: String): LeasesResult
    suspend fun getLeaseById(id: String): Lease?
}
