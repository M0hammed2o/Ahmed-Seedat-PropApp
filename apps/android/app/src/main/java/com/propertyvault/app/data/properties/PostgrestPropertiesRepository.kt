package com.propertyvault.app.data.properties

import com.propertyvault.app.data.local.PropertyDao
import com.propertyvault.app.data.local.PropertyEntity
import com.propertyvault.app.data.network.PostgrestApi
import com.propertyvault.app.data.network.dto.PropertyDto
import javax.inject.Inject

/**
 * Real implementation -- reads Properties via `PostgrestApi` (RLS-scoped to the caller's own
 * orgs), write-through caches into Room on success, falls back to the Room cache on failure
 * (NATIVE_ANDROID_SPEC.md §7/§8). Never mixed with mock/fixture data -- see
 * MockPropertiesRepository for the separate development-only implementation.
 */
class PostgrestPropertiesRepository @Inject constructor(
    private val api: PostgrestApi,
    private val dao: PropertyDao,
) : PropertiesRepository {

    override suspend fun getProperties(): PropertiesResult {
        return try {
            val response = api.getProperties()
            val body = response.body()
            if (!response.isSuccessful || body == null) {
                return fallbackToCache("Failed to load properties (${response.code()})")
            }
            val now = System.currentTimeMillis()
            dao.replaceAll(body.map { it.toEntity(now) })
            PropertiesResult.Live(body.map { it.toDomain() })
        } catch (e: Exception) {
            fallbackToCache(e.message ?: "Failed to load properties")
        }
    }

    override suspend fun getPropertyById(id: String): Property? {
        return try {
            val response = api.getPropertyById(idFilter = "eq.$id")
            response.body()?.firstOrNull()?.toDomain()
                ?: dao.getById(id)?.toDomain()
        } catch (_: Exception) {
            dao.getById(id)?.toDomain()
        }
    }

    private suspend fun fallbackToCache(errorMessage: String): PropertiesResult {
        val cached = dao.getAll()
        return if (cached.isNotEmpty()) {
            PropertiesResult.Cached(cached.map { it.toDomain() }, cached.first().fetchedAtEpochMillis)
        } else {
            PropertiesResult.Error(errorMessage)
        }
    }
}

private fun PropertyDto.toDomain() = Property(
    id = id,
    orgId = orgId,
    nickname = nickname,
    fullAddress = fullAddress,
    city = city,
    province = province,
    propertyType = propertyType,
    municipalAccountNumber = municipalAccountNumber,
    notes = notes,
    status = status,
)

private fun PropertyDto.toEntity(fetchedAtEpochMillis: Long) = PropertyEntity(
    id = id,
    orgId = orgId,
    nickname = nickname,
    fullAddress = fullAddress,
    city = city,
    province = province,
    propertyType = propertyType,
    municipalAccountNumber = municipalAccountNumber,
    notes = notes,
    status = status,
    fetchedAtEpochMillis = fetchedAtEpochMillis,
)

private fun PropertyEntity.toDomain() = Property(
    id = id,
    orgId = orgId,
    nickname = nickname,
    fullAddress = fullAddress,
    city = city,
    province = province,
    propertyType = propertyType,
    municipalAccountNumber = municipalAccountNumber,
    notes = notes,
    status = status,
)
