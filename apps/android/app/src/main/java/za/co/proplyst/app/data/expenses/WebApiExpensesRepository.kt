package za.co.proplyst.app.data.expenses

import android.content.Context
import android.net.Uri
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response
import za.co.proplyst.app.data.network.WebApi
import za.co.proplyst.app.data.network.dto.ExpenseCreateRequest
import za.co.proplyst.app.data.network.dto.WebApiErrorBody
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WebApiExpensesRepository @Inject constructor(
    private val webApi: WebApi,
    @ApplicationContext private val context: Context,
) : ExpensesRepository {

    private val errorJson = Json { ignoreUnknownKeys = true }

    override suspend fun createExpense(input: ExpenseCreateInput): ExpenseCreateResult {
        return try {
            var documentId: String? = null
            if (input.evidenceUri != null) {
                val categoriesResponse = webApi.getDocumentCategories()
                if (!categoriesResponse.isSuccessful) {
                    return ExpenseCreateResult.Error(
                        errorMessage(categoriesResponse) ?: "Could not prepare evidence upload -- try again.",
                    )
                }
                val receiptCategoryId = categoriesResponse.body()?.categories?.firstOrNull { it.slug == "receipt" }?.id
                    ?: return ExpenseCreateResult.Error("Evidence upload is unavailable right now -- save the expense without it.")

                val uploadResponse = webApi.uploadDocument(
                    orgId = input.orgId.toRequestBody("text/plain".toMediaTypeOrNull()),
                    propertyId = input.propertyId.toRequestBody("text/plain".toMediaTypeOrNull()),
                    categoryId = receiptCategoryId.toRequestBody("text/plain".toMediaTypeOrNull()),
                    documentType = "receipt".toRequestBody("text/plain".toMediaTypeOrNull()),
                    file = uriToMultipart(input.evidenceUri),
                )
                if (!uploadResponse.isSuccessful) {
                    return ExpenseCreateResult.Error(errorMessage(uploadResponse) ?: "Failed to upload evidence.")
                }
                documentId = uploadResponse.body()?.document?.id
            }

            val response = webApi.createExpense(
                ExpenseCreateRequest(
                    orgId = input.orgId,
                    propertyId = input.propertyId,
                    unitId = input.unitId,
                    vendorId = null,
                    category = input.category,
                    amount = input.amount,
                    documentId = documentId,
                    referenceNumber = input.referenceNumber,
                    invoiceDate = input.invoiceDate,
                    notes = input.notes,
                ),
            )
            if (!response.isSuccessful) {
                return ExpenseCreateResult.Error(errorMessage(response) ?: "Failed to record this expense.")
            }
            val expense = response.body()?.expense ?: return ExpenseCreateResult.Error("Failed to record this expense.")
            ExpenseCreateResult.Success(expense.id)
        } catch (e: Exception) {
            ExpenseCreateResult.Error(e.message ?: "Failed to record this expense -- check your connection.")
        }
    }

    /** Mirrors WebApiPaymentReportsRepository's own uriToMultipart exactly -- content:// Uris
     * aren't directly readable as a File by OkHttp, so this reads into a temp cache file first. */
    private fun uriToMultipart(uri: Uri): MultipartBody.Part {
        val resolver = context.contentResolver
        val mimeType = resolver.getType(uri) ?: "application/octet-stream"
        val extension = when (mimeType) {
            "image/png" -> ".png"
            "application/pdf" -> ".pdf"
            else -> ".jpg"
        }
        val tempFile = File.createTempFile("expense_evidence", extension, context.cacheDir)
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
}
