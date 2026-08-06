package com.propertyvault.app.data.tenants

sealed interface TenantsResult {
    data class Live(val tenants: List<Tenant>) : TenantsResult
    data class Cached(val tenants: List<Tenant>, val fetchedAtEpochMillis: Long) : TenantsResult
    data class Error(val message: String) : TenantsResult
}

/** Org-wide, same shape as PropertiesRepository (not property-scoped like UnitsRepository) --
 * matches apps/admin's own Tenants module, which is org-wide rather than nested under a
 * property. */
interface TenantsRepository {
    suspend fun getTenants(): TenantsResult
    suspend fun getTenantById(id: String): Tenant?
}
