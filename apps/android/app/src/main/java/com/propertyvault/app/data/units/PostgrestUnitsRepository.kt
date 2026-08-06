package com.propertyvault.app.data.units

import com.propertyvault.app.data.local.UnitDao
import com.propertyvault.app.data.local.UnitEntity
import com.propertyvault.app.data.network.PostgrestApi
import com.propertyvault.app.data.network.dto.UnitDto
import javax.inject.Inject

/** Real implementation -- same write-through-cache-then-fallback shape as
 * PostgrestPropertiesRepository, scoped per property rather than per org. */
class PostgrestUnitsRepository @Inject constructor(
    private val api: PostgrestApi,
    private val dao: UnitDao,
) : UnitsRepository {

    override suspend fun getUnitsByProperty(propertyId: String): UnitsResult {
        return try {
            val response = api.getUnitsByProperty(propertyIdFilter = "eq.$propertyId")
            val body = response.body()
            if (!response.isSuccessful || body == null) {
                return fallbackToCache(propertyId, "Failed to load units (${response.code()})")
            }
            val now = System.currentTimeMillis()
            dao.replaceForProperty(propertyId, body.map { it.toEntity(now) })
            UnitsResult.Live(body.map { it.toDomain() })
        } catch (e: Exception) {
            fallbackToCache(propertyId, e.message ?: "Failed to load units")
        }
    }

    override suspend fun getUnitById(id: String): PropertyUnit? {
        return try {
            val response = api.getUnitById(idFilter = "eq.$id")
            response.body()?.firstOrNull()?.toDomain()
                ?: dao.getById(id)?.toDomain()
        } catch (_: Exception) {
            dao.getById(id)?.toDomain()
        }
    }

    private suspend fun fallbackToCache(propertyId: String, errorMessage: String): UnitsResult {
        val cached = dao.getByProperty(propertyId)
        return if (cached.isNotEmpty()) {
            UnitsResult.Cached(cached.map { it.toDomain() }, cached.first().fetchedAtEpochMillis)
        } else {
            UnitsResult.Error(errorMessage)
        }
    }
}

private fun UnitDto.toDomain() = PropertyUnit(
    id = id,
    propertyId = propertyId,
    orgId = orgId,
    unitLabel = unitLabel,
    bedrooms = bedrooms,
    bathrooms = bathrooms,
    sizeSqm = sizeSqm,
    marketRent = marketRent,
    status = status,
)

private fun UnitDto.toEntity(fetchedAtEpochMillis: Long) = UnitEntity(
    id = id,
    propertyId = propertyId,
    orgId = orgId,
    unitLabel = unitLabel,
    bedrooms = bedrooms,
    bathrooms = bathrooms,
    sizeSqm = sizeSqm,
    marketRent = marketRent,
    status = status,
    fetchedAtEpochMillis = fetchedAtEpochMillis,
)

private fun UnitEntity.toDomain() = PropertyUnit(
    id = id,
    propertyId = propertyId,
    orgId = orgId,
    unitLabel = unitLabel,
    bedrooms = bedrooms,
    bathrooms = bathrooms,
    sizeSqm = sizeSqm,
    marketRent = marketRent,
    status = status,
)
