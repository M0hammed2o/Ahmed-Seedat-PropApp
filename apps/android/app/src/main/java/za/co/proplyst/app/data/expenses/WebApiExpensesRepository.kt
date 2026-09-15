package za.co.proplyst.app.data.expenses

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response
import za.co.proplyst.app.data.network.WebApi
import za.co.proplyst.app.data.network.dto.ExpenseCreateRequest
import za.co.proplyst.app.data.network.dto.WebApiErrorBody
import za.co.proplyst.app.data.network.prepareUpload
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

                // Photos are resized and re-encoded to fit the upload scanner (UploadImagePolicy); the
                // prepared cache file is deleted as soon as the upload call returns.
                val uploadResponse = prepareUpload(context, input.evidenceUri, "expense_evidence").use { upload ->
                    webApi.uploadDocument(
                        orgId = input.orgId.toRequestBody("text/plain".toMediaTypeOrNull()),
                        propertyId = input.propertyId.toRequestBody("text/plain".toMediaTypeOrNull()),
                        categoryId = receiptCategoryId.toRequestBody("text/plain".toMediaTypeOrNull()),
                        documentType = "receipt".toRequestBody("text/plain".toMediaTypeOrNull()),
                        file = upload.part,
                    )
                }
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
                    categoryCode = expenseCategoryCodeFor(input.category),
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

    private fun errorMessage(response: Response<*>): String? {
        val raw = response.errorBody()?.string() ?: return null
        return try {
            errorJson.decodeFromString<WebApiErrorBody>(raw).error?.message
        } catch (_: Exception) {
            null
        }
    }
}
