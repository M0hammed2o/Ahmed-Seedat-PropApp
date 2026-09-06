package za.co.proplyst.app.ui.dashboard

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * V1 release-gate pass. Home's "Properties" KPI previously fell back to the size of the Top
 * Properties list, which DashboardViewModel deliberately truncates to 6. A real 10-property demo
 * portfolio therefore rendered "6 Properties" on Home while the Properties tab and the web
 * dashboard both showed 10 -- an owner-visible contradiction between two screens of the same app,
 * and a web/Android parity break.
 *
 * These pin the rule: prefer the server-computed portfolio count, never infer it from a truncated
 * list, and show an em dash rather than a wrong number when it genuinely is not known yet.
 */
class PropertyCountLabelTest {

    @Test
    fun `prefers the portfolio financial summary count`() {
        assertEquals("10", resolvePropertyCountLabel(financialCount = 10, monthlySummaryCount = 4))
    }

    @Test
    fun `falls back to the monthly summary count when the financial summary has not loaded`() {
        assertEquals("7", resolvePropertyCountLabel(financialCount = null, monthlySummaryCount = 7))
    }

    @Test
    fun `shows an em dash rather than guessing when neither count is available`() {
        assertEquals("—", resolvePropertyCountLabel(financialCount = null, monthlySummaryCount = null))
    }

    @Test
    fun `a zero-property portfolio still reports zero, not an em dash`() {
        // 0 is a real, known answer -- it must not be confused with "unknown".
        assertEquals("0", resolvePropertyCountLabel(financialCount = 0, monthlySummaryCount = null))
    }
}
