package za.co.proplyst.app.data.announcements

import za.co.proplyst.app.data.network.WebApi
import za.co.proplyst.app.data.network.dto.AnnouncementDto
import za.co.proplyst.app.data.network.dto.WebApiErrorBody
import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import retrofit2.Response
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WebApiAnnouncementsRepository @Inject constructor(
    private val webApi: WebApi,
) : AnnouncementsRepository {

    private val errorJson = Json { ignoreUnknownKeys = true }

    override suspend fun getMyAnnouncements(): AnnouncementsResult {
        return try {
            val response = webApi.getMyAnnouncements()
            if (!response.isSuccessful) {
                return AnnouncementsResult.Error(errorMessage(response) ?: "Failed to load announcements.")
            }
            val announcements = response.body()?.announcements.orEmpty().map { it.toDomain() }
            AnnouncementsResult.Loaded(announcements)
        } catch (e: Exception) {
            AnnouncementsResult.Error(e.message ?: "Failed to load announcements — check your connection.")
        }
    }

    override suspend fun acknowledge(id: String): AcknowledgeResult {
        return try {
            val response = webApi.acknowledgeAnnouncement(id)
            if (!response.isSuccessful) {
                return AcknowledgeResult.Error(errorMessage(response) ?: "Failed to acknowledge this announcement.")
            }
            AcknowledgeResult.Success
        } catch (e: Exception) {
            AcknowledgeResult.Error(e.message ?: "Failed to acknowledge — check your connection.")
        }
    }

    private fun errorMessage(response: Response<*>): String? {
        val raw = response.errorBody()?.string() ?: return null
        return try {
            errorJson.decodeFromString<WebApiErrorBody>(raw).error?.message
        } catch (_: Exception) {
            null
        }
    }

    private fun AnnouncementDto.toDomain() = Announcement(
        id = id,
        title = title,
        body = body,
        propertyId = propertyId,
        requiresAcknowledgement = requiresAcknowledgement,
        publishedAt = publishedAt,
        expiresAt = expiresAt,
    )
}
