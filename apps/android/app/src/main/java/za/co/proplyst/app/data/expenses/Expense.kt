package za.co.proplyst.app.data.expenses

import android.net.Uri

/** Owner Add Expense (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §5). Category is free text, matching
 * the existing `expenses.category` model exactly (never a locked enum) -- [SUGGESTED_CATEGORIES]
 * below is what the picker offers, not a validation constraint. Vendor selection is deliberately
 * NOT built in this pass (a full vendor search/create picker is real additional scope beyond an
 * optional field) -- vendorId is always null from this screen, disclosed in
 * UTILITIES_RATES_BUDGET_IMPLEMENTATION.md, not silently narrowed. */
/**
 * Canonical expense classification sent alongside the free-text label.
 *
 * POST /api/v1/expenses requires `categoryCode` (packages/validation expenseCreateSchema, a
 * non-optional z.enum) since migration 20260101000168 introduced the DB-level
 * expense_category_code enum. Android was never updated, so EVERY expense save from the phone
 * failed validation with "Check the highlighted fields" -- found on the emulator against the real
 * public backend (Android UX pass, 2026-09-08).
 *
 * Deliberately mirrors the database's own infer_expense_category_code() mapping, including the
 * `else 'other'` fallback, so a free-text category typed on the phone classifies identically to
 * one typed on the web. `category` remains the human label; this is what financial bucketing reads.
 */
fun expenseCategoryCodeFor(label: String): String = when (label.trim().lowercase()) {
    "rates & taxes", "rates and taxes", "rates_and_taxes", "rates", "municipal rates" -> "rates_taxes"
    "levies", "levy" -> "levies"
    "water" -> "water"
    "electricity", "power" -> "electricity"
    "maintenance" -> "maintenance"
    "security" -> "security"
    "insurance" -> "insurance"
    "cleaning" -> "cleaning"
    "management", "management fee" -> "management"
    else -> "other"
}

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
