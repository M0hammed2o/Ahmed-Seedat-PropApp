package za.co.proplyst.app.data.network.dto

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The insights payload must carry its triggering records all the way into Android.
 *
 * This is where the actionable-alerts pass actually begins: the web API has always returned
 * `data_source` (apps/admin/lib/ai.ts's mapPortfolioInsightRow), and Android parsed the row and
 * threw the object away, which is the sole reason a Needs-attention card could not open the record
 * it was describing. The shapes below are copied from what
 * apps/admin/lib/portfolioIntelligence.ts writes.
 *
 * The mixed casing is not a mistake and is the thing most likely to be "tidied" into a bug: the API
 * maps the ROW to camelCase, but the jsonb's own keys stay snake_case exactly as the rules engine
 * wrote them.
 */
class InsightDtoTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `parses the triggering record out of data_source`() {
        val payload = """
            {
              "id": "ins-1",
              "orgId": "org-1",
              "insightType": "invoice_unpaid",
              "message": "Invoice of R9,400 is 6 days overdue",
              "severity": "urgent",
              "generatedAt": "2026-09-11T08:00:00Z",
              "dismissedAt": null,
              "dataSource": {
                "insight_type": "invoice_unpaid",
                "triggering_records": [
                  { "table": "invoices", "id": "inv-42", "period": "2026-09", "amount": 9400 }
                ]
              }
            }
        """.trimIndent()

        val dto = json.decodeFromString(InsightDto.serializer(), payload)
        val record = dto.dataSource?.triggeringRecords?.single()

        assertEquals("invoices", record?.table)
        assertEquals("inv-42", record?.id)
    }

    @Test
    fun `keeps the first record when the engine lists several`() {
        // portfolioIntelligence.ts builds its reconciliation key from the first record, so that is
        // the one the row should open.
        val payload = """
            {
              "id": "ins-2", "orgId": "org-1", "insightType": "budget_exceeded",
              "message": "Over budget", "severity": "urgent",
              "generatedAt": "2026-09-11T08:00:00Z",
              "dataSource": { "triggering_records": [
                { "table": "property_budgets", "id": "b-1" },
                { "table": "expenses", "id": "e-9" }
              ] }
            }
        """.trimIndent()

        val dto = json.decodeFromString(InsightDto.serializer(), payload)
        assertEquals("property_budgets", dto.dataSource?.triggeringRecords?.first()?.table)
        assertEquals(2, dto.dataSource?.triggeringRecords?.size)
    }

    @Test
    fun `an insight with no data_source still parses`() {
        // Must degrade to "not tappable", never to a parse failure that blanks the whole feed.
        val payload = """
            {
              "id": "ins-3", "orgId": "org-1", "insightType": "something_new",
              "message": "New kind of alert", "severity": "info",
              "generatedAt": "2026-09-11T08:00:00Z"
            }
        """.trimIndent()

        val dto = json.decodeFromString(InsightDto.serializer(), payload)
        assertNull(dto.dataSource)
    }

    @Test
    fun `an unfamiliar data_source shape does not break the row`() {
        val payload = """
            {
              "id": "ins-4", "orgId": "org-1", "insightType": "invoice_unpaid",
              "message": "Overdue", "severity": "urgent",
              "generatedAt": "2026-09-11T08:00:00Z",
              "dataSource": { "insight_type": "invoice_unpaid", "something_unexpected": 7 }
            }
        """.trimIndent()

        val dto = json.decodeFromString(InsightDto.serializer(), payload)
        assertTrue(dto.dataSource?.triggeringRecords.orEmpty().isEmpty())
    }

    @Test
    fun `a triggering record missing its table or id parses as absent`() {
        val payload = """
            {
              "id": "ins-5", "orgId": "org-1", "insightType": "maintenance_open",
              "message": "Open ticket", "severity": "warning",
              "generatedAt": "2026-09-11T08:00:00Z",
              "dataSource": { "triggering_records": [ { "days_open": 9 } ] }
            }
        """.trimIndent()

        val dto = json.decodeFromString(InsightDto.serializer(), payload)
        val record = dto.dataSource?.triggeringRecords?.single()
        assertNull(record?.table)
        assertNull(record?.id)
    }
}
