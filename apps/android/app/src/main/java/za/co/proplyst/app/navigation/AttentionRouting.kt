package za.co.proplyst.app.navigation

import androidx.navigation.NavController
import za.co.proplyst.app.data.insights.AttentionCategory
import za.co.proplyst.app.data.insights.AttentionItem
import za.co.proplyst.app.data.insights.AttentionMember
import za.co.proplyst.app.data.notifications.AppNotification

/**
 * Where a tapped alert or activity row goes.
 *
 * Actionable-alerts pass. Before this, Needs-attention rows were not clickable at all and Activity
 * rows only marked themselves read, so both surfaces told an owner something was wrong and then
 * gave them no way through to it. The mapping lives here, as pure functions over plain data, for
 * two reasons: all three surfaces (Home preview, Needs-attention, Activity) must agree on it, and
 * it is then unit-testable without Compose, a NavController or a database.
 *
 * The routes are the ones that already exist in [Destinations]. Nothing here queries, re-derives or
 * re-implements business logic -- the rules engine already recorded which record triggered each
 * insight, and this file only decides which existing screen shows that record.
 *
 * SECURITY NOTE. Navigating by id is safe here and must stay that way: every destination loads
 * through the ordinary session-scoped repositories, so Postgres RLS decides whether the caller may
 * see the row. A stale or foreign id produces the destination's own not-found/error state, never
 * another organisation's record. Nothing in this file bypasses that, and nothing in it should ever
 * reach for the service-role client.
 */
sealed interface AttentionDestination {
    /** Open this route. */
    data class Route(val route: String) : AttentionDestination

    /** No sensible destination -- the row stays inert rather than guessing. */
    data object None : AttentionDestination

    /** Group with no dedicated list screen: expand it in place instead of navigating. */
    data object Expand : AttentionDestination
}

/**
 * The destination for a single triggering record, keyed on the Postgres table the rules engine
 * named in `data_source.triggering_records[].table`.
 *
 * Two tables deliberately resolve to a list rather than a detail screen, because no per-record
 * screen exists for them and inventing one is not this pass's job:
 *  - `rent_schedules` -> Rent status, which is the screen that shows exactly this (paid/unpaid per
 *    property and month);
 *  - `property_budgets` -> Budget, which shows planned-versus-actual for the period.
 * `utility_readings` resolves to the utilities overview for the same reason.
 */
fun destinationForEntity(table: String?, id: String?): AttentionDestination {
    val entityId = id?.takeIf { it.isNotBlank() }
    // Tolerate both singular and plural spellings. The insights engine writes table names
    // ('invoices', 'maintenance_tickets'); notify.ts writes singular entity names
    // ('invoice', 'maintenance_ticket'). Same records, two vocabularies, one mapping.
    return when (table?.lowercase()?.trim()) {
        "invoices", "invoice" ->
            if (entityId == null) AttentionDestination.Route(Destinations.INVOICES_LIST)
            else AttentionDestination.Route(Destinations.invoiceDetail(entityId))

        "maintenance_tickets", "maintenance_ticket" ->
            if (entityId == null) AttentionDestination.Route(Destinations.MAINTENANCE_LIST)
            else AttentionDestination.Route(Destinations.maintenanceDetail(entityId))

        "leases", "lease" ->
            if (entityId == null) AttentionDestination.None
            else AttentionDestination.Route(Destinations.leaseDetailById(entityId))

        "rent_schedules", "rent_schedule" ->
            AttentionDestination.Route(Destinations.RENT_STATUS_LIST)

        "property_budgets", "property_budget" ->
            AttentionDestination.Route(Destinations.BUDGET_VIEW)

        "utility_readings", "utility_reading" ->
            AttentionDestination.Route(Destinations.UTILITY_OVERVIEW)

        "payment_reports", "payment_report" ->
            AttentionDestination.Route(Destinations.PAYMENT_REVIEW_LIST)

        else -> AttentionDestination.None
    }
}

/** A single underlying record, tapped from an expanded group. */
fun destinationForMember(member: AttentionMember): AttentionDestination =
    destinationForEntity(member.entityTable, member.entityId)

/**
 * The list screen that shows every record behind a collapsed group.
 *
 * A group must never open one arbitrarily chosen member -- "1007 overdue rent invoices" is not a
 * statement about any single invoice. Where a real list screen exists it wins, because it brings
 * its own paging, filtering and empty states. Where one does not (leases have no org-wide list,
 * and OTHER is by definition unclassified), the row expands in place instead, which still reaches
 * every individual record.
 */
fun destinationForGroup(category: AttentionCategory): AttentionDestination = when (category) {
    AttentionCategory.PAYMENTS -> AttentionDestination.Route(Destinations.PAYMENT_REVIEW_LIST)
    AttentionCategory.BUDGET -> AttentionDestination.Route(Destinations.BUDGET_VIEW)
    AttentionCategory.UTILITIES -> AttentionDestination.Route(Destinations.UTILITY_OVERVIEW)
    AttentionCategory.MAINTENANCE -> AttentionDestination.Route(Destinations.MAINTENANCE_LIST)
    // Rent groups are mixed: unpaid invoices belong on the invoice ledger, rent schedules on Rent
    // status. Resolved from the members' own table by the caller below, which knows them.
    AttentionCategory.RENT -> AttentionDestination.Route(Destinations.RENT_STATUS_LIST)
    AttentionCategory.LEASE, AttentionCategory.OTHER -> AttentionDestination.Expand
}

/**
 * Destination for a Needs-attention row as shown on the **Needs-attention screen**, where a group
 * can expand in place.
 */
fun destinationForAttentionItem(item: AttentionItem): AttentionDestination {
    val single = item.singleMember
    if (single != null) {
        val direct = destinationForMember(single)
        // A single row whose table is unknown still belongs to a category that usually has a
        // sensible home; fall through rather than leaving it dead.
        if (direct != AttentionDestination.None) return direct
    }
    // The PAYMENTS row is synthesised from the financial summary and carries no members at all.
    if (item.category == AttentionCategory.PAYMENTS) {
        return AttentionDestination.Route(Destinations.PAYMENT_REVIEW_LIST)
    }
    // A rent group made entirely of invoices belongs on the invoice ledger, not Rent status.
    if (item.category == AttentionCategory.RENT && item.members.isNotEmpty() &&
        item.members.all { it.entityTable?.lowercase()?.trim() in setOf("invoices", "invoice") }
    ) {
        return AttentionDestination.Route(Destinations.INVOICES_LIST)
    }
    return destinationForGroup(item.category)
}

/**
 * Destination for a Needs-attention row as shown on the **Home preview**, which has no room to
 * expand anything.
 *
 * Identical to [destinationForAttentionItem] except that a group with no dedicated list opens the
 * full Needs-attention screen already filtered to that category, where it *can* be expanded. That
 * is the "appropriately filtered list" a grouped row deserves, rather than an arbitrary member.
 */
fun destinationForDashboardItem(item: AttentionItem): AttentionDestination =
    when (val resolved = destinationForAttentionItem(item)) {
        is AttentionDestination.Expand ->
            AttentionDestination.Route(Destinations.needsAttention(item.category.name))
        else -> resolved
    }

/**
 * Destination for an Activity row.
 *
 * Driven by `related_entity_type`/`related_entity_id`, which `notifyPropertyStaff` has always
 * written (apps/admin/lib/notify.ts) and which Android already parsed and then ignored. The four
 * types the backend actually creates today are maintenance_ticket_created, rent_overdue,
 * lease_expiring and payment_awaiting_confirmation; all four resolve through the shared entity
 * mapping above, so a fifth added server-side becomes tappable here for free as long as it names
 * a table this file knows.
 *
 * Returning [AttentionDestination.None] is a normal outcome, not a failure: the row is still
 * tapped, still marked read, and simply does not navigate.
 */
fun destinationForNotification(notification: AppNotification): AttentionDestination =
    destinationForEntity(notification.relatedEntityType, notification.relatedEntityId)

/**
 * Navigates, tolerating a route this NavHost does not know.
 *
 * The Owner and Tenant portals are separate NavHosts with overlapping but unequal route sets, and
 * an alert is only data -- a tenant-side activity can legitimately name a record that only the
 * owner graph can show. `NavController.navigate` throws IllegalArgumentException for an unknown
 * destination, which would turn that into a crash from a tap. Swallowing it leaves the row inert,
 * which is the correct outcome and the same one a null entity id produces.
 *
 * This is a navigation guard only. It grants no access: the destination still loads through the
 * session-scoped repositories, so RLS decides what the caller may actually see.
 */
fun NavController.navigateToAlertDestination(route: String) {
    runCatching { navigate(route) }
}
