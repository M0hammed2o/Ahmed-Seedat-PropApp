package za.co.proplyst.app.data.tenants

import za.co.proplyst.app.data.local.TenantDao
import za.co.proplyst.app.data.local.TenantEntity
import za.co.proplyst.app.data.network.PostgrestApi
import za.co.proplyst.app.data.network.dto.TenantDto
import javax.inject.Inject

class PostgrestTenantsRepository @Inject constructor(
    private val api: PostgrestApi,
    private val dao: TenantDao,
) : TenantsRepository {

    override suspend fun getTenants(): TenantsResult {
        return try {
            val response = api.getTenants()
            val body = response.body()
            if (!response.isSuccessful || body == null) {
                return fallbackToCache("Failed to load tenants (${response.code()})")
            }
            val now = System.currentTimeMillis()
            dao.replaceAll(body.map { it.toEntity(now) })
            TenantsResult.Live(body.map { it.toDomain() })
        } catch (e: Exception) {
            fallbackToCache(e.message ?: "Failed to load tenants")
        }
    }

    override suspend fun getTenantById(id: String): Tenant? {
        return try {
            val response = api.getTenantById(idFilter = "eq.$id")
            response.body()?.firstOrNull()?.toDomain()
                ?: dao.getById(id)?.toDomain()
        } catch (_: Exception) {
            dao.getById(id)?.toDomain()
        }
    }

    private suspend fun fallbackToCache(errorMessage: String): TenantsResult {
        val cached = dao.getAll()
        return if (cached.isNotEmpty()) {
            TenantsResult.Cached(cached.map { it.toDomain() }, cached.first().fetchedAtEpochMillis)
        } else {
            TenantsResult.Error(errorMessage)
        }
    }
}

private fun TenantDto.toDomain() = Tenant(
    id = id,
    orgId = orgId,
    fullName = fullName,
    email = email,
    phone = phone,
    status = status,
)

private fun TenantDto.toEntity(fetchedAtEpochMillis: Long) = TenantEntity(
    id = id,
    orgId = orgId,
    fullName = fullName,
    email = email,
    phone = phone,
    status = status,
    fetchedAtEpochMillis = fetchedAtEpochMillis,
)

private fun TenantEntity.toDomain() = Tenant(
    id = id,
    orgId = orgId,
    fullName = fullName,
    email = email,
    phone = phone,
    status = status,
)
