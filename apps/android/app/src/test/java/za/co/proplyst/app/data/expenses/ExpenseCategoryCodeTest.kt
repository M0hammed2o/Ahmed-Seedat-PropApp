package za.co.proplyst.app.data.expenses

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * POST /api/v1/expenses requires `categoryCode` (a non-optional enum) since migration
 * 20260101000168. Android sent only the free-text `category`, so every expense save from the phone
 * failed server-side validation with "Check the highlighted fields" -- found on the emulator
 * against the real public backend (Android UX pass, 2026-09-08).
 *
 * The mapping must agree with the database's own infer_expense_category_code(), or the same
 * expense would bucket differently depending on which device recorded it.
 */
class ExpenseCategoryCodeTest {

    @Test
    fun `every suggested chip except Other maps to a specific code`() {
        SUGGESTED_EXPENSE_CATEGORIES.filter { it != "Other" }.forEach { label ->
            assertNotEquals("$label fell through to 'other'", "other", expenseCategoryCodeFor(label))
        }
    }

    @Test
    fun `chips map to the canonical codes`() {
        assertEquals("rates_taxes", expenseCategoryCodeFor("Rates & taxes"))
        assertEquals("levies", expenseCategoryCodeFor("Levies"))
        assertEquals("water", expenseCategoryCodeFor("Water"))
        assertEquals("electricity", expenseCategoryCodeFor("Electricity"))
        assertEquals("maintenance", expenseCategoryCodeFor("Maintenance"))
        assertEquals("security", expenseCategoryCodeFor("Security"))
        assertEquals("insurance", expenseCategoryCodeFor("Insurance"))
        assertEquals("cleaning", expenseCategoryCodeFor("Cleaning"))
        assertEquals("management", expenseCategoryCodeFor("Management"))
        assertEquals("other", expenseCategoryCodeFor("Other"))
    }

    @Test
    fun `matches the database function on case, whitespace and synonyms`() {
        assertEquals("water", expenseCategoryCodeFor("  WATER  "))
        assertEquals("electricity", expenseCategoryCodeFor("Power"))
        assertEquals("management", expenseCategoryCodeFor("management fee"))
        assertEquals("rates_taxes", expenseCategoryCodeFor("rates_and_taxes"))
        assertEquals("levies", expenseCategoryCodeFor("levy"))
    }

    @Test
    fun `free text a user types falls back to other rather than being guessed`() {
        assertEquals("other", expenseCategoryCodeFor("Gardening service"))
        assertEquals("other", expenseCategoryCodeFor(" "))
    }
}
