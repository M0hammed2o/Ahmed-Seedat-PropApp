package za.co.proplyst.app.data.insights

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Android UX pass (2026-09-08). Owner Home rendered every insight inline, so a real portfolio put a
 * 417-card wall above everything else on the dashboard. These pin the bounded, prioritised,
 * grouped presentation that replaced it.
 *
 * The feed itself was audited and is correct -- 1024 active rows against 1024 distinct dedup keys,
 * zero duplicates -- so the contract here is that grouping never LOSES a record, only collapses how
 * it is displayed.
 */
class AttentionPresentationTest {

    private fun insight(
        id: String,
        type: String,
        severity: String,
        message: String = "message $id",
    ) = PortfolioInsight(
        id = id,
        insightType = type,
        message = message,
        severity = severity,
        generatedAt = "2026-09-08T00:00:00Z",
    )

    private fun manyOverdueInvoices(n: Int) =
        (1..n).map { insight("inv-$it", "invoice_unpaid", "urgent", "Invoice of R${it}00 is 6 days overdue.") }

    @Test
    fun `preview is capped regardless of portfolio size`() {
        val preview = buildAttentionPreview(manyOverdueInvoices(1007), awaitingConfirmationCount = 3)
        assertTrue(
            "preview must never exceed $MAX_DASHBOARD_ATTENTION_ITEMS rows, got ${preview.size}",
            preview.size <= MAX_DASHBOARD_ATTENTION_ITEMS,
        )
    }

    @Test
    fun `hundreds of near-identical overdue invoices collapse into one row that states the real count`() {
        val preview = buildAttentionPreview(manyOverdueInvoices(1007))
        val rent = preview.single { it.category == AttentionCategory.RENT }
        assertEquals(1007, rent.count)
        assertEquals("1007 overdue rent invoices", rent.title)
        // Nothing may be lost -- the detail screen still needs every underlying record.
        assertEquals(1007, rent.insightIds.size)
    }

    @Test
    fun `the badge total counts underlying conditions, not collapsed rows`() {
        val insights = manyOverdueInvoices(1007)
        assertEquals(1010, totalAttentionCount(insights, awaitingConfirmationCount = 3))
        // ...while the preview it sits above stays small.
        assertTrue(buildAttentionPreview(insights, 3).size <= MAX_DASHBOARD_ATTENTION_ITEMS)
    }

    @Test
    fun `payments awaiting confirmation lead the preview`() {
        val preview = buildAttentionPreview(manyOverdueInvoices(50), awaitingConfirmationCount = 2)
        assertEquals(AttentionCategory.PAYMENTS, preview.first().category)
        assertEquals("2 payments are awaiting your confirmation", preview.first().title)
        assertEquals("REVIEW", preview.first().actionLabel)
    }

    @Test
    fun `critical outranks warning even when the warning group is much larger`() {
        val insights = buildList {
            addAll((1..200).map { insight("w-$it", "invoice_unpaid", "warning") })
            add(insight("c-1", "budget_exceeded", "urgent"))
        }
        val preview = buildAttentionPreview(insights)
        assertEquals(
            "a single critical item must outrank a 200-strong warning group",
            AttentionSeverity.CRITICAL,
            preview.first().severity,
        )
    }

    @Test
    fun `preview is not simply the first four rows of the feed`() {
        // A low-priority informational row placed FIRST in the feed must not win a preview slot
        // ahead of the critical rows behind it.
        val insights = buildList {
            add(insight("info-1", "maintenance_open", "info"))
            addAll((1..10).map { insight("c-$it", "rent_overdue", "urgent") })
            add(insight("b-1", "budget_exceeded", "urgent"))
        }
        val preview = buildAttentionPreview(insights)
        assertEquals(AttentionSeverity.CRITICAL, preview.first().severity)
        assertTrue(preview.first().count >= 10)
    }

    @Test
    fun `a single item keeps its own specific message rather than a vague group label`() {
        val one = listOf(insight("x", "invoice_unpaid", "urgent", "Invoice of R9 400 is 6 days overdue."))
        val item = buildAttentionPreview(one).single()
        assertEquals("Invoice of R9 400 is 6 days overdue.", item.title)
        assertEquals(1, item.count)
    }

    @Test
    fun `grouping preserves every insight id across all categories`() {
        val insights = buildList {
            addAll(manyOverdueInvoices(30))
            add(insight("m-1", "maintenance_open", "urgent"))
            add(insight("u-1", "unusual_utility_usage", "warning"))
            add(insight("l-1", "lease_expiring", "warning"))
            add(insight("b-1", "budget_approaching", "warning"))
        }
        val all = groupInsights(insights)
        assertEquals(insights.size, all.sumOf { it.insightIds.size })
        assertEquals(insights.map { it.id }.toSet(), all.flatMap { it.insightIds }.toSet())
    }

    @Test
    fun `every known insight type maps to a real category, never Other`() {
        val known = listOf(
            "invoice_unpaid", "rent_overdue", "rent_due_soon",
            "budget_approaching", "budget_exceeded",
            "unusual_utility_usage", "maintenance_open", "lease_expiring",
        )
        known.forEach {
            assertTrue("$it fell through to OTHER", categoryOf(it) != AttentionCategory.OTHER)
        }
    }

    @Test
    fun `grouped rows invite the owner into the detail screen`() {
        val grouped = buildAttentionPreview(manyOverdueInvoices(12)).single()
        assertNotNull(grouped.subtitle)
        assertEquals("Tap to review", grouped.subtitle)
    }

    @Test
    fun `an empty feed produces an empty preview and a zero total`() {
        assertTrue(buildAttentionPreview(emptyList()).isEmpty())
        assertEquals(0, totalAttentionCount(emptyList()))
    }
}
