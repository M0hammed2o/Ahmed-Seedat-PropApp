package za.co.proplyst.app.data.utilities

import android.content.Context
import android.net.Uri
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response
import za.co.proplyst.app.data.network.WebApi
import za.co.proplyst.app.data.network.dto.UtilityHistoryPointDto
import za.co.proplyst.app.data.network.dto.UtilityMeterDto
import za.co.proplyst.app.data.network.dto.UtilityReadingCreateRequest
import za.co.proplyst.app.data.network.dto.WebApiErrorBody
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WebApiUtilitiesRepository @Inject constructor(
    private val webApi: WebApi,
    @ApplicationContext private val context: Context,
) : UtilitiesRepository {

    private val errorJson = Json { ignoreUnknownKeys = true }

    override suspend fun getMeters(propertyId: String, unitId: String?): UtilityMetersResult {
        return try {
            val response = webApi.getUtilityMeters(propertyId, unitId)
            if (!response.isSuccessful) {
                return UtilityMetersResult.Error(errorMessage(response) ?: "Failed to load meters.")
            }
            UtilityMetersResult.Loaded(response.body()?.utilityMeters.orEmpty().map { it.toDomain() })
        } catch (e: Exception) {
            UtilityMetersResult.Error(e.message ?: "Failed to load meters -- check your connection.")
        }
    }

    override suspend fun getReadingHistory(meterId: String): UtilityHistoryResult {
        return try {
            val response = webApi.getUtilityReadingHistory(meterId)
            if (!response.isSuccessful) {
                return UtilityHistoryResult.Error(errorMessage(response) ?: "Failed to load reading history.")
            }
            UtilityHistoryResult.Loaded(response.body()?.history.orEmpty().map { it.toDomain() })
        } catch (e: Exception) {
            UtilityHistoryResult.Error(e.message ?: "Failed to load reading history -- check your connection.")
        }
    }

    override suspend fun recordReading(
        orgId: String,
        propertyId: String,
        meterId: String,
        utilityType: String,
        periodMonth: String,
        readingDate: String,
        readingValue: Double,
        unitOfMeasure: String,
        evidenceUri: Uri?,
        notes: String?,
    ): UtilityReadingSubmitResult {
        return try {
            var documentId: String? = null
            if (evidenceUri != null) {
                val categoriesResponse = webApi.getDocumentCategories()
                if (!categoriesResponse.isSuccessful) {
                    return UtilityReadingSubmitResult.Error("Could not prepare evidence upload -- try again.")
                }
                val categorySlug = if (utilityType == "water") "water" else "electricity"
                val categoryId = categoriesResponse.body()?.categories?.firstOrNull { it.slug == categorySlug }?.id
                    ?: return UtilityReadingSubmitResult.Error("Evidence upload is unavailable right now -- save the reading without it.")

                val uploadResponse = webApi.uploadDocument(
                    orgId = orgId.toRequestBody("text/plain".toMediaTypeOrNull()),
                    propertyId = propertyId.toRequestBody("text/plain".toMediaTypeOrNull()),
                    categoryId = categoryId.toRequestBody("text/plain".toMediaTypeOrNull()),
                    documentType = "bill".toRequestBody("text/plain".toMediaTypeOrNull()),
                    file = uriToMultipart(evidenceUri),
                )
                if (!uploadResponse.isSuccessful) {
                    return UtilityReadingSubmitResult.Error(errorMessage(uploadResponse) ?: "Failed to upload evidence.")
                }
                documentId = uploadResponse.body()?.document?.id
            }

            val response = webApi.createUtilityReading(
                meterId,
                UtilityReadingCreateRequest(
                    periodMonth = periodMonth,
                    readingDate = readingDate,
                    readingValue = readingValue,
                    unitOfMeasure = unitOfMeasure,
                    documentId = documentId,
                    notes = notes,
                ),
            )
            if (!response.isSuccessful) {
                return UtilityReadingSubmitResult.Error(errorMessage(response) ?: "Failed to record this reading.")
            }
            UtilityReadingSubmitResult.Success
        } catch (e: Exception) {
            UtilityReadingSubmitResult.Error(e.message ?: "Failed to record this reading -- check your connection.")
        }
    }

    private fun uriToMultipart(uri: Uri): MultipartBody.Part {
        val resolver = context.contentResolver
        val mimeType = resolver.getType(uri) ?: "application/octet-stream"
        val extension = when (mimeType) {
            "image/png" -> ".png"
            "application/pdf" -> ".pdf"
            else -> ".jpg"
        }
        val tempFile = File.createTempFile("utility_bill", extension, context.cacheDir)
        resolver.openInputStream(uri)?.use { input ->
            tempFile.outputStream().use { output -> input.copyTo(output) }
        }
        val requestBody = tempFile.asRequestBody(mimeType.toMediaTypeOrNull())
        return MultipartBody.Part.createFormData("file", tempFile.name, requestBody)
    }

    private fun errorMessage(response: Response<*>): String? {
        val raw = response.errorBody()?.string() ?: return null
        return try {
            errorJson.decodeFromString<WebApiErrorBody>(raw).error?.message
        } catch (_: Exception) {
            null
        }
    }

    private fun UtilityMeterDto.toDomain() = UtilityMeter(
        id = id,
        propertyId = propertyId,
        unitId = unitId,
        utilityType = utilityType,
        meterNumber = meterNumber,
        responsibilityMode = responsibilityMode,
        isPrepaid = isPrepaid,
        active = active,
    )

    private fun UtilityHistoryPointDto.toDomain() = UtilityHistoryPoint(
        periodMonth = periodMonth,
        readingValue = readingValue,
        consumption = consumption,
        previousConsumption = previousConsumption,
        percentChange = percentChange,
        isUnusualUsage = isUnusualUsage,
    )
}
