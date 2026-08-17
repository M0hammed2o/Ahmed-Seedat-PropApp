package za.co.proplyst.app.data.maintenance

import za.co.proplyst.app.data.local.MaintenanceTicketDao
import za.co.proplyst.app.data.local.MaintenanceTicketEntity
import za.co.proplyst.app.data.network.PostgrestApi
import za.co.proplyst.app.data.network.WebApi
import za.co.proplyst.app.data.network.dto.CreateTenantMaintenanceTicketRequest
import za.co.proplyst.app.data.network.dto.MaintenanceTicketCreatedDto
import za.co.proplyst.app.data.network.dto.MaintenanceTicketDto
import javax.inject.Inject

class PostgrestMaintenanceRepository @Inject constructor(
    private val api: PostgrestApi,
    private val webApi: WebApi,
    private val dao: MaintenanceTicketDao,
) : MaintenanceRepository {

    override suspend fun getTickets(): MaintenanceResult {
        return try {
            val response = api.getMaintenanceTickets()
            val body = response.body()
            if (!response.isSuccessful || body == null) {
                return fallbackToCache("Failed to load maintenance tickets (${response.code()})")
            }
            val now = System.currentTimeMillis()
            dao.replaceAll(body.map { it.toEntity(now) })
            MaintenanceResult.Live(body.map { it.toDomain() })
        } catch (e: Exception) {
            fallbackToCache(e.message ?: "Failed to load maintenance tickets")
        }
    }

    override suspend fun getTicketById(id: String): MaintenanceTicket? {
        return try {
            val response = api.getMaintenanceTicketById(idFilter = "eq.$id")
            response.body()?.firstOrNull()?.toDomain()
                ?: dao.getById(id)?.toDomain()
        } catch (_: Exception) {
            dao.getById(id)?.toDomain()
        }
    }

    override suspend fun createTicket(
        summary: String,
        description: String?,
        priority: String,
    ): CreateMaintenanceTicketResult {
        if (summary.isBlank()) return CreateMaintenanceTicketResult.Error("Summary is required.")
        return try {
            val response = webApi.createTenantMaintenanceTicket(
                CreateTenantMaintenanceTicketRequest(summary = summary, description = description, priority = priority),
            )
            val body = response.body()
            if (!response.isSuccessful || body == null) {
                CreateMaintenanceTicketResult.Error("Failed to submit maintenance ticket (${response.code()})")
            } else {
                CreateMaintenanceTicketResult.Success(body.maintenanceTicket.toDomain())
            }
        } catch (e: Exception) {
            CreateMaintenanceTicketResult.Error(e.message ?: "Failed to submit maintenance ticket")
        }
    }

    private suspend fun fallbackToCache(errorMessage: String): MaintenanceResult {
        val cached = dao.getAll()
        return if (cached.isNotEmpty()) {
            MaintenanceResult.Cached(cached.map { it.toDomain() }, cached.first().fetchedAtEpochMillis)
        } else {
            MaintenanceResult.Error(errorMessage)
        }
    }
}

private fun MaintenanceTicketDto.toDomain() = MaintenanceTicket(
    id = id,
    orgId = orgId,
    propertyId = propertyId,
    summary = summary,
    description = description,
    priority = priority,
    status = status,
    createdAt = createdAt,
)

private fun MaintenanceTicketDto.toEntity(fetchedAtEpochMillis: Long) = MaintenanceTicketEntity(
    id = id,
    orgId = orgId,
    propertyId = propertyId,
    summary = summary,
    description = description,
    priority = priority,
    status = status,
    createdAt = createdAt,
    fetchedAtEpochMillis = fetchedAtEpochMillis,
)

private fun MaintenanceTicketEntity.toDomain() = MaintenanceTicket(
    id = id,
    orgId = orgId,
    propertyId = propertyId,
    summary = summary,
    description = description,
    priority = priority,
    status = status,
    createdAt = createdAt,
)

private fun MaintenanceTicketCreatedDto.toDomain() = MaintenanceTicket(
    id = id,
    orgId = orgId,
    propertyId = propertyId,
    summary = summary,
    description = description,
    priority = priority,
    status = status,
    createdAt = createdAt,
)
