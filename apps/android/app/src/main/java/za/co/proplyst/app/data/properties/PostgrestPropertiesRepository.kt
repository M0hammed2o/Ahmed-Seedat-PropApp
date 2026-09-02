package za.co.proplyst.app.data.properties

import za.co.proplyst.app.data.local.PropertyDao
import za.co.proplyst.app.data.local.PropertyEntity
import za.co.proplyst.app.data.network.PostgrestApi
import za.co.proplyst.app.data.network.WebApi
import za.co.proplyst.app.data.network.dto.PropertyCardExtrasDto
import za.co.proplyst.app.data.network.dto.PropertyDto
import javax.inject.Inject

/**
 * Real implementation -- reads Properties via `PostgrestApi` (RLS-scoped to the caller's own
 * orgs), write-through caches into Room on success, falls back to the Room cache on failure
 * (NATIVE_ANDROID_SPEC.md §7/§8). Never mixed with mock/fixture data -- see
 * MockPropertiesRepository for the separate development-only implementation.
 *
 * Proplyst Mobile Design System redesign pass: also layers in card-visual extras (signed cover
 * photo, real unit/occupancy counts) via a best-effort [WebApi] call -- see [WebApi
 * .getPropertyCards]'s own doc comment. A card-extras failure never fails the property read
 * itself; those fields just stay at their [Property] defaults (no photo, 0/0 units), which is a
 * real, honest degraded state, not a fabricated one. Card extras are never persisted to Room --
 * the offline/cached fallback path simply shows plain cards.
 */
class PostgrestPropertiesRepository @Inject constructor(
    private val api: PostgrestApi,
    private val webApi: WebApi,
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
            val cardExtras = loadCardExtras()
            PropertiesResult.Live(body.map { it.toDomain().withCardExtras(cardExtras[it.id]) })
        } catch (e: Exception) {
            fallbackToCache(e.message ?: "Failed to load properties")
        }
    }

    override suspend fun getPropertyById(id: String): Property? {
        val base = try {
            val response = api.getPropertyById(idFilter = "eq.$id")
            response.body()?.firstOrNull()?.toDomain()
                ?: dao.getById(id)?.toDomain()
        } catch (_: Exception) {
            dao.getById(id)?.toDomain()
        } ?: return null

        val extras = try {
            val response = webApi.getPropertyCard(id)
            if (response.isSuccessful) response.body()?.property else null
        } catch (_: Exception) {
            null
        }
        return base.withCardExtras(extras)
    }

    private suspend fun loadCardExtras(): Map<String, PropertyCardExtrasDto> {
        return try {
            val response = webApi.getPropertyCards()
            if (!response.isSuccessful) return emptyMap()
            response.body()?.properties.orEmpty().associateBy { it.id }
        } catch (_: Exception) {
            emptyMap()
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

private fun Property.withCardExtras(extras: PropertyCardExtrasDto?): Property {
    if (extras == null) return this
    return copy(
        coverPhotoUrl = extras.coverPhotoUrl,
        unitCount = extras.unitCount,
        occupiedUnitCount = extras.occupiedUnitCount,
    )
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
