package za.co.proplyst.app.data.paymentreports

import android.content.Context
import za.co.proplyst.app.data.network.WebApi
import za.co.proplyst.app.data.network.dto.PaymentReportDto
import za.co.proplyst.app.data.network.dto.RejectPaymentReportRequest
import za.co.proplyst.app.data.network.prepareUpload
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import za.co.proplyst.app.data.network.dto.WebApiErrorBody
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WebApiPaymentReportsRepository @Inject constructor(
    private val webApi: WebApi,
    @ApplicationContext private val context: Context,
) : PaymentReportsRepository {

    private val errorJson = Json { ignoreUnknownKeys = true }

    override suspend fun getMyPaymentReports(): PaymentReportsResult {
        return try {
            val response = webApi.getMyPaymentReports()
            if (!response.isSuccessful) {
                return PaymentReportsResult.Error(errorMessage(response) ?: "Failed to load payments.")
            }
            val reports = response.body()?.paymentReports.orEmpty().map { it.toDomain() }
            PaymentReportsResult.Loaded(reports)
        } catch (e: Exception) {
            PaymentReportsResult.Error(e.message ?: "Failed to load payments — check your connection.")
        }
    }

    override suspend fun reportPayment(input: ReportPaymentInput): ReportPaymentResult {
        return try {
            // Photos are resized and re-encoded to fit the upload scanner (UploadImagePolicy); the
            // prepared cache file is deleted as soon as the upload call returns.
            val proof = input.proofUri?.let { prepareUpload(context, it, "proof_of_payment") }
            val response = try {
                webApi.reportPayment(
                    amount = input.amount.toString().toRequestBody("text/plain".toMediaTypeOrNull()),
                    paymentMethod = input.paymentMethod.toRequestBody("text/plain".toMediaTypeOrNull()),
                    paymentDate = input.paymentDate.toRequestBody("text/plain".toMediaTypeOrNull()),
                    proof = proof?.part,
                )
            } finally {
                proof?.close()
            }
            if (!response.isSuccessful) {
                return ReportPaymentResult.Error(errorMessage(response) ?: "Failed to report payment.")
            }
            val body = response.body() ?: return ReportPaymentResult.Error("Failed to report payment.")
            ReportPaymentResult.Success(body.paymentReport.toDomain())
        } catch (e: Exception) {
            ReportPaymentResult.Error(e.message ?: "Failed to report payment — check your connection.")
        }
    }

    override suspend fun confirmPaymentReport(id: String): PaymentReviewResult {
        return try {
            val response = webApi.confirmPaymentReport(id)
            if (!response.isSuccessful) {
                return PaymentReviewResult.Error(errorMessage(response) ?: "Failed to confirm this payment report.")
            }
            PaymentReviewResult.Success
        } catch (e: Exception) {
            PaymentReviewResult.Error(e.message ?: "Failed to confirm — check your connection.")
        }
    }

    override suspend fun rejectPaymentReport(id: String, reason: String): PaymentReviewResult {
        return try {
            val response = webApi.rejectPaymentReport(id, RejectPaymentReportRequest(reason))
            if (!response.isSuccessful) {
                return PaymentReviewResult.Error(errorMessage(response) ?: "Failed to reject this payment report.")
            }
            PaymentReviewResult.Success
        } catch (e: Exception) {
            PaymentReviewResult.Error(e.message ?: "Failed to reject — check your connection.")
        }
    }

    override suspend fun getDocumentUrl(documentId: String): DocumentUrlResult {
        return try {
            val response = webApi.getDocument(documentId)
            if (!response.isSuccessful) {
                return DocumentUrlResult.Error(errorMessage(response) ?: "Failed to open this document.")
            }
            val body = response.body() ?: return DocumentUrlResult.Error("Failed to open this document.")
            DocumentUrlResult.Success(body.signedUrl, body.document.mimeType)
        } catch (e: Exception) {
            DocumentUrlResult.Error(e.message ?: "Failed to open this document — check your connection.")
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

    private fun PaymentReportDto.toDomain() = PaymentReport(
        id = id,
        amount = amount,
        paymentMethod = paymentMethod,
        paymentDate = paymentDate,
        status = status,
        rejectionReason = rejectionReason,
        createdAt = createdAt,
        tenantName = tenantName,
        propertyName = propertyName,
        documentId = documentId,
        reportedByTenant = reportedByTenant,
    )
}
