package za.co.proplyst.app.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import za.co.proplyst.app.data.insights.AttentionCategory
import za.co.proplyst.app.data.insights.PortfolioInsight
import za.co.proplyst.app.data.insights.groupInsights
import za.co.proplyst.app.data.notifications.AppNotification

/**
 * Every alert and activity type must lead somewhere sensible.
 *
 * The whole point of the actionable-alerts pass is that a row telling an owner something is wrong
 * also takes them to the thing that is wrong. These tests are the guard rail: they enumerate every
 * insight type the rules engine emits (apps/admin/lib/portfolioIntelligence.ts) and every
 * notification type the backend creates (apps/admin/lib/notify.ts call sites), and assert a
 * destination for each. A new type added server-side with no mapping here shows up as a failing
 * test rather than as a dead row on a phone.
 */
class AttentionRoutingTest {

    private fun insight(
        id: String,
        insightType: String,
        severity: String = "urgent",
        table: String? = null,
        entityId: String? = null,
        message: String = "something needs attention",
    ) = PortfolioInsight(
        id = id,
        insightType = insightType,
        message = message,
        severity = severity,
        generatedAt = "2026-09-11T08:00:00Z",
        entityTable = table,
        entityId = entityId,
    )

    private fun notification(
        type: String,
        entityType: String?,
        entityId: String?,
    ) = AppNotification(
        id = "n-$type",
        type = type,
        title = type,
        body = null,
        relatedEntityType = entityType,
        relatedEntityId = entityId,
        readAt = null,
        createdAt = "2026-09-11T08:00:00Z",
    )

    private fun routeOf(d: AttentionDestination): String {
        assertTrue("expected a route, got $d", d is AttentionDestination.Route)
        return (d as AttentionDestination.Route).route
    }

    // ---------- single records, one per insight type ----------

    @Test
    fun `invoice_unpaid opens that invoice`() {
        val item = groupInsights(listOf(insight("i1", "invoice_unpaid", table = "invoices", entityId = "inv-9"))).single()
        assertEquals("invoices/inv-9", routeOf(destinationForAttentionItem(item)))
    }

    @Test
    fun `maintenance_open opens that ticket`() {
        val item = groupInsights(
            listOf(insight("i1", "maintenance_open", table = "maintenance_tickets", entityId = "t-4")),
        ).single()
        assertEquals("maintenance/t-4", routeOf(destinationForAttentionItem(item)))
    }

    @Test
    fun `lease_expiring opens that lease by id`() {
        val item = groupInsights(listOf(insight("i1", "lease_expiring", table = "leases", entityId = "l-2"))).single()
        assertEquals("leases/l-2", routeOf(destinationForAttentionItem(item)))
    }

    @Test
    fun `rent_overdue opens rent status`() {
        val item = groupInsights(
            listOf(insight("i1", "rent_overdue", table = "rent_schedules", entityId = "rs-1")),
        ).single()
        assertEquals(Destinations.RENT_STATUS_LIST, routeOf(destinationForAttentionItem(item)))
    }

    @Test
    fun `rent_due_soon opens rent status`() {
        val item = groupInsights(
            listOf(insight("i1", "rent_due_soon", severity = "warning", table = "rent_schedules", entityId = "rs-2")),
        ).single()
        assertEquals(Destinations.RENT_STATUS_LIST, routeOf(destinationForAttentionItem(item)))
    }

    @Test
    fun `budget_exceeded opens the budget screen`() {
        val item = groupInsights(
            listOf(insight("i1", "budget_exceeded", table = "property_budgets", entityId = "b-1")),
        ).single()
        assertEquals(Destinations.BUDGET_VIEW, routeOf(destinationForAttentionItem(item)))
    }

    @Test
    fun `budget_approaching opens the budget screen`() {
        val item = groupInsights(
            listOf(insight("i1", "budget_approaching", severity = "warning", table = "property_budgets", entityId = "b-2")),
        ).single()
        assertEquals(Destinations.BUDGET_VIEW, routeOf(destinationForAttentionItem(item)))
    }

    @Test
    fun `unusual_utility_usage opens the utilities overview`() {
        val item = groupInsights(
            listOf(insight("i1", "unusual_utility_usage", severity = "warning", table = "utility_readings", entityId = "u-1")),
        ).single()
        assertEquals(Destinations.UTILITY_OVERVIEW, routeOf(destinationForAttentionItem(item)))
    }

    @Test
    fun `payments awaiting confirmation open the payment review workflow`() {
        val item = groupInsights(emptyList(), awaitingConfirmationCount = 3).single()
        assertEquals(AttentionCategory.PAYMENTS, item.category)
        assertEquals(Destinations.PAYMENT_REVIEW_LIST, routeOf(destinationForAttentionItem(item)))
    }

    // ---------- grouped rows must never open one arbitrary member ----------

    @Test
    fun `a group of unpaid invoices opens the invoice ledger, not one invoice`() {
        val rows = (1..40).map { insight("i$it", "invoice_unpaid", table = "invoices", entityId = "inv-$it") }
        val item = groupInsights(rows).single()
        assertEquals(40, item.count)
        val route = routeOf(destinationForAttentionItem(item))
        assertEquals(Destinations.INVOICES_LIST, route)
        assertTrue("a group must not target a single member", rows.none { route == "invoices/${it.entityId}" })
    }

    @Test
    fun `a group of maintenance tickets opens the maintenance list`() {
        val rows = (1..5).map { insight("i$it", "maintenance_open", table = "maintenance_tickets", entityId = "t-$it") }
        val item = groupInsights(rows).single()
        assertEquals(Destinations.MAINTENANCE_LIST, routeOf(destinationForAttentionItem(item)))
    }

    @Test
    fun `a lease group has no list screen so it expands in place`() {
        val rows = (1..3).map { insight("i$it", "lease_expiring", table = "leases", entityId = "l-$it") }
        val item = groupInsights(rows).single()
        assertEquals(AttentionDestination.Expand, destinationForAttentionItem(item))
        // Expanding must still reach every underlying record individually.
        assertEquals(3, item.members.size)
        assertEquals(
            listOf("leases/l-1", "leases/l-2", "leases/l-3"),
            item.members.map { routeOf(destinationForMember(it)) },
        )
    }

    @Test
    fun `on Home a lease group opens the filtered list instead of expanding`() {
        val rows = (1..3).map { insight("i$it", "lease_expiring", table = "leases", entityId = "l-$it") }
        val item = groupInsights(rows).single()
        assertEquals(
            "needs_attention?category=LEASE",
            routeOf(destinationForDashboardItem(item)),
        )
    }

    @Test
    fun `grouping keeps every underlying record`() {
        val rows = (1..12).map { insight("i$it", "invoice_unpaid", table = "invoices", entityId = "inv-$it") }
        val item = groupInsights(rows).single()
        assertEquals(rows.map { it.id }.toSet(), item.insightIds.toSet())
    }

    // ---------- stale, deleted, and unmapped records ----------

    @Test
    fun `an insight with no triggering record falls back to its category, never crashes`() {
        val item = groupInsights(listOf(insight("i1", "invoice_unpaid", table = null, entityId = null))).single()
        // The rules engine always writes a triggering record, so this is a defensive path. With no
        // record to identify, the row can only be as specific as its category -- RENT -- which
        // lands on Rent status, the screen for "rent needs attention". The point of the test is
        // that it still goes somewhere useful instead of becoming a dead row.
        assertEquals(Destinations.RENT_STATUS_LIST, routeOf(destinationForAttentionItem(item)))
    }

    @Test
    fun `a blank entity id is treated as absent`() {
        assertEquals(
            Destinations.INVOICES_LIST,
            routeOf(destinationForEntity("invoices", "   ")),
        )
    }

    @Test
    fun `an unknown table yields no destination rather than a guessed route`() {
        assertEquals(AttentionDestination.None, destinationForEntity("some_future_table", "x-1"))
        assertEquals(AttentionDestination.None, destinationForEntity(null, null))
    }

    @Test
    fun `an unknown insight type still routes somewhere via its category`() {
        val item = groupInsights(listOf(insight("i1", "something_new_server_side"))).single()
        assertEquals(AttentionCategory.OTHER, item.category)
        // OTHER has no list screen, so it expands -- it is never silently inert.
        assertEquals(AttentionDestination.Expand, destinationForAttentionItem(item))
    }

    // ---------- Activity rows ----------

    @Test
    fun `activity - maintenance_ticket_created opens the ticket`() {
        val n = notification("maintenance_ticket_created", "maintenance_ticket", "t-77")
        assertEquals("maintenance/t-77", routeOf(destinationForNotification(n)))
    }

    @Test
    fun `activity - payment_awaiting_confirmation opens the confirm-reject workflow`() {
        val n = notification("payment_awaiting_confirmation", "payment_report", "pr-3")
        assertEquals(Destinations.PAYMENT_REVIEW_LIST, routeOf(destinationForNotification(n)))
    }

    @Test
    fun `activity - rent_overdue opens rent status`() {
        val n = notification("rent_overdue", "rent_schedule", "rs-8")
        assertEquals(Destinations.RENT_STATUS_LIST, routeOf(destinationForNotification(n)))
    }

    @Test
    fun `activity - lease_expiring opens the lease`() {
        val n = notification("lease_expiring", "lease", "l-12")
        assertEquals("leases/l-12", routeOf(destinationForNotification(n)))
    }

    @Test
    fun `activity - an entity the app cannot route stays inert but is still openable`() {
        val n = notification("billing_plan_changed", "billing_plan_change", "bp-1")
        assertEquals(AttentionDestination.None, destinationForNotification(n))
    }

    @Test
    fun `singular and plural table spellings resolve identically`() {
        // The insights engine writes table names; notify.ts writes singular entity names.
        assertEquals(destinationForEntity("invoices", "x"), destinationForEntity("invoice", "x"))
        assertEquals(
            destinationForEntity("maintenance_tickets", "x"),
            destinationForEntity("maintenance_ticket", "x"),
        )
        assertEquals(destinationForEntity("leases", "x"), destinationForEntity("lease", "x"))
    }

    @Test
    fun `entity table matching is case and whitespace tolerant`() {
        assertEquals("invoices/x", routeOf(destinationForEntity("  Invoices  ", "x")))
    }

    // ---------- the destination is an id, never an authorisation ----------

    @Test
    fun `routing only ever builds a path from the id it was given`() {
        // Routing carries no org, no role and no bypass -- a foreign id produces an ordinary route
        // whose screen then loads through the session-scoped repository, where RLS refuses it.
        // This test exists to fail loudly if anyone ever adds an org or service-role parameter here.
        val foreign = destinationForEntity("invoices", "an-invoice-in-another-org")
        assertEquals("invoices/an-invoice-in-another-org", routeOf(foreign))
    }

    // ---------- the types the LIVE feed actually holds ----------
    //
    // Probing the production demo organisation found eight of nine notifications with
    // related_entity_type NULL. The four types the notify.ts call sites write are a minority of
    // what is in the table, so routing on entity id alone left almost every real Activity row
    // inert. These are the exact `type` values read back from production on 11 September 2026.
    // Every one of them must resolve, or the Activity screen is decorative again.

    @Test
    fun `every notification type in the live feed resolves to a destination`() {
        val live = mapOf(
            "rent_overdue" to Destinations.RENT_STATUS_LIST,
            "rent_partial" to Destinations.RENT_STATUS_LIST,
            "payment_confirmation_required" to Destinations.PAYMENT_REVIEW_LIST,
            "budget_exceeded" to Destinations.BUDGET_VIEW,
            "budget_approaching" to Destinations.BUDGET_VIEW,
            "utility_unusual_usage" to Destinations.UTILITY_OVERVIEW,
            "maintenance_update" to Destinations.MAINTENANCE_LIST,
            "lease_expiring" to "needs_attention?category=LEASE",
        )
        for ((type, expected) in live) {
            val d = destinationForNotification(notification(type, null, null))
            assertEquals("live type '$type' must route", expected, routeOf(d))
        }
    }

    @Test
    fun `the notify_ts types still resolve without entity columns`() {
        assertEquals(
            Destinations.MAINTENANCE_LIST,
            routeOf(destinationForNotification(notification("maintenance_ticket_created", null, null))),
        )
        assertEquals(
            Destinations.PAYMENT_REVIEW_LIST,
            routeOf(destinationForNotification(notification("payment_awaiting_confirmation", null, null))),
        )
    }

    @Test
    fun `an entity id still wins over the type fallback`() {
        // When notifyPropertyStaff does fill the columns in, the specific record must beat the
        // generic list -- the fallback is a floor, not a replacement.
        val n = notification("maintenance_update", "maintenance_ticket", "t-55")
        assertEquals("maintenance/t-55", routeOf(destinationForNotification(n)))
    }

    @Test
    fun `payment confirmation is not mistaken for a rent reminder`() {
        // 'rent_payment_reminder' mentions both domains; order of matching decides it.
        assertEquals(
            Destinations.RENT_STATUS_LIST,
            routeOf(destinationForNotificationType("rent_payment_reminder")),
        )
        assertEquals(
            Destinations.PAYMENT_REVIEW_LIST,
            routeOf(destinationForNotificationType("payment_confirmation_required")),
        )
    }

    @Test
    fun `an unrecognised type with no entity is inert rather than wrong`() {
        assertEquals(AttentionDestination.None, destinationForNotificationType("account_security_event"))
        assertEquals(AttentionDestination.None, destinationForNotificationType(null))
        assertEquals(AttentionDestination.None, destinationForNotificationType("  "))
    }
}
