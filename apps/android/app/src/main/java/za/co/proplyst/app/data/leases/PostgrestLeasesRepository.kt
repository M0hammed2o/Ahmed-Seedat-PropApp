package za.co.proplyst.app.data.leases

import za.co.proplyst.app.data.local.LeaseDao
import za.co.proplyst.app.data.local.LeaseEntity
import za.co.proplyst.app.data.network.PostgrestApi
import za.co.proplyst.app.data.network.dto.LeaseDto
import javax.inject.Inject

class PostgrestLeasesRepository @Inject constructor(
    private val api: PostgrestApi,
    private val dao: LeaseDao,
) : LeasesRepository {

    override suspend fun getLeasesByUnit(unitId: String): LeasesResult {
        return try {
            val response = api.getLeasesByUnit(unitIdFilter = "eq.$unitId")
            val body = response.body()
            if (!response.isSuccessful || body == null) {
                return fallbackToCache(unitId, "Failed to load leases (${response.code()})")
            }
            val now = System.currentTimeMillis()
            dao.replaceForUnit(unitId, body.map { it.toEntity(now) })
            LeasesResult.Live(body.map { it.toDomain() })
        } catch (e: Exception) {
            fallbackToCache(unitId, e.message ?: "Failed to load leases")
        }
    }

    override suspend fun getLeaseById(id: String): Lease? {
        return try {
            val response = api.getLeaseById(idFilter = "eq.$id")
            response.body()?.firstOrNull()?.toDomain()
                ?: dao.getById(id)?.toDomain()
        } catch (_: Exception) {
            dao.getById(id)?.toDomain()
        }
    }

    private suspend fun fallbackToCache(unitId: String, errorMessage: String): LeasesResult {
        val cached = dao.getByUnit(unitId)
        return if (cached.isNotEmpty()) {
            LeasesResult.Cached(cached.map { it.toDomain() }, cached.first().fetchedAtEpochMillis)
        } else {
            LeasesResult.Error(errorMessage)
        }
    }
}

private fun LeaseDto.toDomain() = Lease(
    id = id,
    orgId = orgId,
    unitId = unitId,
    startDate = startDate,
    endDate = endDate,
    rentAmount = rentAmount,
    rentFrequency = rentFrequency,
    depositAmount = depositAmount,
    status = status,
)

private fun LeaseDto.toEntity(fetchedAtEpochMillis: Long) = LeaseEntity(
    id = id,
    orgId = orgId,
    unitId = unitId,
    startDate = startDate,
    endDate = endDate,
    rentAmount = rentAmount,
    rentFrequency = rentFrequency,
    depositAmount = depositAmount,
    status = status,
    fetchedAtEpochMillis = fetchedAtEpochMillis,
)

private fun LeaseEntity.toDomain() = Lease(
    id = id,
    orgId = orgId,
    unitId = unitId,
    startDate = startDate,
    endDate = endDate,
    rentAmount = rentAmount,
    rentFrequency = rentFrequency,
    depositAmount = depositAmount,
    status = status,
)
