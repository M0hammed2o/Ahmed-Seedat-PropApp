package za.co.proplyst.app.data.network.dto

import kotlinx.serialization.Serializable

/** V1 utilities/rates/levies/budgets continuation pass -- Android owner Add Expense workflow.
 * Mirrors POST /api/v1/expenses' expenseCreateSchema exactly (packages/validation/src/accounting.ts). */
@Serializable
data class ExpenseCreateRequest(
    val orgId: String,
    val propertyId: String,
    val unitId: String? = null,
    val vendorId: String? = null,
    val category: String,
    val amount: Double,
    val documentId: String? = null,
    val referenceNumber: String? = null,
    val invoiceDate: String? = null,
    val notes: String? = null,
)

@Serializable
data class ExpenseDto(
    val id: String,
    val orgId: String,
    val propertyId: String,
    val unitId: String? = null,
    val vendorId: String? = null,
    val category: String,
    val amount: Double,
    val status: String,
    val documentId: String? = null,
)

@Serializable
data class ExpenseCreateResponse(val expense: ExpenseDto)

@Serializable
data class DocumentCategoryDto(
    val id: String,
    val slug: String,
    val label: String,
    val isDefault: Boolean,
)

@Serializable
data class DocumentCategoryListResponse(val categories: List<DocumentCategoryDto>)

@Serializable
data class DocumentUploadResponseDto(val document: DocumentSummaryDto)

@Serializable
data class DocumentSummaryDto(val id: String)
