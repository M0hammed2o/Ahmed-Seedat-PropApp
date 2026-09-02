package za.co.proplyst.app.data.expenses

import android.net.Uri

/** Owner Add Expense (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §5). Category is free text, matching
 * the existing `expenses.category` model exactly (never a locked enum) -- [SUGGESTED_CATEGORIES]
 * below is what the picker offers, not a validation constraint. Vendor selection is deliberately
 * NOT built in this pass (a full vendor search/create picker is real additional scope beyond an
 * optional field) -- vendorId is always null from this screen, disclosed in
 * UTILITIES_RATES_BUDGET_IMPLEMENTATION.md, not silently narrowed. */
val SUGGESTED_EXPENSE_CATEGORIES = listOf(
    "Rates & taxes",
    "Levies",
    "Water",
    "Electricity",
    "Maintenance",
    "Security",
    "Insurance",
    "Cleaning",
    "Management",
    "Other",
)

data class ExpenseCreateInput(
    val orgId: String,
    val propertyId: String,
    val unitId: String?,
    val category: String,
    val amount: Double,
    val referenceNumber: String?,
    val invoiceDate: String?,
    val notes: String?,
    val evidenceUri: Uri?,
)

sealed interface ExpenseCreateResult {
    data class Success(val expenseId: String) : ExpenseCreateResult
    data class Error(val message: String) : ExpenseCreateResult
}

interface ExpensesRepository {
    suspend fun createExpense(input: ExpenseCreateInput): ExpenseCreateResult
}
