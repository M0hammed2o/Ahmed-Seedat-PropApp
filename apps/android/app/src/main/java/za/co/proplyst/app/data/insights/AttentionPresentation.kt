package za.co.proplyst.app.data.insights

/**
 * Turns the raw portfolio-insights feed into something a phone screen can actually show.
 *
 * Android UX pass (2026-09-08). Owner Home rendered `insights.forEach { InsightRow(it) }` with no
 * bound, so a real portfolio produced a 417-card wall that buried every other section hundreds of
 * screens down. The feed itself is correct -- an audit confirmed 1024 active rows against 1024
 * distinct dedup keys, zero duplicates, so this is a presentation problem and NOT something to
 * "fix" by deleting or hiding alert records.
 *
 * Two transformations, both pure so they can be unit-tested without Compose or a database:
 *
 *  1. GROUPING. 1007 of those 1024 rows were `invoice_unpaid`. Ninety near-identical
 *     "Invoice of R9,400 is 6 days overdue" cards tell an owner nothing that "1007 overdue rent
 *     invoices" doesn't tell them better. Rows are collapsed per (category, severity), keeping
 *     every underlying id so the detail screen can still reach the individual records.
 *  2. PRIORITY. The preview takes the most important groups, never simply the first N rows of
 *     whatever order the database returned.
 */

/** The categories the full Needs-attention screen filters by. */
enum class AttentionCategory(val label: String) {
    PAYMENTS("Payments"),
    RENT("Rent"),
    BUDGET("Budget"),
    UTILITIES("Utilities"),
    MAINTENANCE("Maintenance"),
    LEASE("Lease"),
    OTHER("Other"),
}

enum class AttentionSeverity { CRITICAL, WARNING, INFO }

/**
 * One row as the UI shows it. [count] > 1 means this is a collapsed group; [insightIds] always
 * carries every underlying record so nothing is lost.
 */
data class AttentionItem(
    val title: String,
    val subtitle: String?,
    val category: AttentionCategory,
    val severity: AttentionSeverity,
    val count: Int,
    val insightIds: List<String>,
    val actionLabel: String,
)

fun severityOf(raw: String): AttentionSeverity = when (raw.lowercase()) {
    "urgent", "critical" -> AttentionSeverity.CRITICAL
    "warning" -> AttentionSeverity.WARNING
    else -> AttentionSeverity.INFO
}

fun categoryOf(insightType: String): AttentionCategory = when (insightType.lowercase()) {
    "invoice_unpaid", "rent_overdue", "rent_due_soon" -> AttentionCategory.RENT
    "budget_approaching", "budget_exceeded" -> AttentionCategory.BUDGET
    "unusual_utility_usage" -> AttentionCategory.UTILITIES
    "maintenance_open" -> AttentionCategory.MAINTENANCE
    "lease_expiring" -> AttentionCategory.LEASE
    else -> AttentionCategory.OTHER
}

/**
 * Plain-language label for a collapsed group. Deliberately avoids the raw insight_type, which is a
 * database identifier and not something to show an owner.
 */
private fun groupTitle(category: AttentionCategory, severity: AttentionSeverity, count: Int): String {
    val plural = count != 1
    return when (category) {
        AttentionCategory.RENT ->
            if (severity == AttentionSeverity.CRITICAL) {
                if (plural) "$count overdue rent invoices" else "1 overdue rent invoice"
            } else {
                if (plural) "$count rent invoices need attention" else "1 rent invoice needs attention"
            }
        AttentionCategory.BUDGET ->
            if (severity == AttentionSeverity.CRITICAL) {
                if (plural) "$count properties are over budget" else "1 property is over budget"
            } else {
                if (plural) "$count properties are approaching budget" else "1 property is approaching budget"
            }
        AttentionCategory.UTILITIES ->
            if (plural) "$count meters show unusual usage" else "1 meter shows unusual usage"
        AttentionCategory.MAINTENANCE ->
            if (plural) "$count maintenance tickets are open" else "1 maintenance ticket is open"
        AttentionCategory.LEASE ->
            if (plural) "$count leases are expiring soon" else "1 lease is expiring soon"
        AttentionCategory.PAYMENTS ->
            if (plural) "$count payments are awaiting your confirmation" else "1 payment is awaiting your confirmation"
        AttentionCategory.OTHER ->
            if (plural) "$count items need attention" else "1 item needs attention"
    }
}

private fun actionFor(category: AttentionCategory, severity: AttentionSeverity): String = when {
    category == AttentionCategory.PAYMENTS -> "REVIEW"
    severity == AttentionSeverity.CRITICAL -> "CRITICAL"
    severity == AttentionSeverity.WARNING -> "WARNING"
    else -> "REVIEW"
}

/**
 * Ordering used for both the preview and the full list. Payments first (directly actionable and
 * time-sensitive), then anything critical, then warnings, then the rest. Within a tier the larger
 * group leads, because "1007 overdue invoices" matters more than a single one.
 */
private fun rank(item: AttentionItem): Int {
    val categoryWeight = when (item.category) {
        AttentionCategory.PAYMENTS -> 0
        AttentionCategory.RENT -> 1
        AttentionCategory.BUDGET -> 2
        AttentionCategory.UTILITIES -> 3
        AttentionCategory.MAINTENANCE -> 4
        AttentionCategory.LEASE -> 5
        AttentionCategory.OTHER -> 6
    }
    val severityWeight = when (item.severity) {
        AttentionSeverity.CRITICAL -> 0
        AttentionSeverity.WARNING -> 1
        AttentionSeverity.INFO -> 2
    }
    // Severity dominates so a critical maintenance ticket outranks an informational rent row.
    return severityWeight * 10 + categoryWeight
}

/**
 * Collapses the raw feed into grouped rows, most important first.
 *
 * A single-row "group" keeps its own original message, so an owner with one overdue invoice still
 * sees the specific detail rather than a needlessly vague "1 overdue rent invoice".
 */
fun groupInsights(
    insights: List<PortfolioInsight>,
    awaitingConfirmationCount: Int = 0,
): List<AttentionItem> {
    val grouped = insights
        .groupBy { categoryOf(it.insightType) to severityOf(it.severity) }
        .map { (key, rows) ->
            val (category, severity) = key
            AttentionItem(
                title = if (rows.size == 1) rows.first().message else groupTitle(category, severity, rows.size),
                subtitle = if (rows.size == 1) null else "Tap to review",
                category = category,
                severity = severity,
                count = rows.size,
                insightIds = rows.map { it.id },
                actionLabel = actionFor(category, severity),
            )
        }

    val payments = if (awaitingConfirmationCount > 0) {
        listOf(
            AttentionItem(
                title = groupTitle(AttentionCategory.PAYMENTS, AttentionSeverity.CRITICAL, awaitingConfirmationCount),
                subtitle = null,
                category = AttentionCategory.PAYMENTS,
                severity = AttentionSeverity.CRITICAL,
                count = awaitingConfirmationCount,
                // Live figure from the financial summary, not a stored insight row -- no ids to carry.
                insightIds = emptyList(),
                actionLabel = "REVIEW",
            ),
        )
    } else {
        emptyList()
    }

    return (payments + grouped).sortedWith(compareBy({ rank(it) }, { -it.count }))
}

/** The bounded Owner Home preview. Never more than [limit] rows, whatever the portfolio size. */
fun buildAttentionPreview(
    insights: List<PortfolioInsight>,
    awaitingConfirmationCount: Int = 0,
    limit: Int = MAX_DASHBOARD_ATTENTION_ITEMS,
): List<AttentionItem> = groupInsights(insights, awaitingConfirmationCount).take(limit)

/**
 * Total the badge shows: every underlying condition, not the number of collapsed rows. An owner
 * with 1007 overdue invoices should see 1007, then a preview that fits on one screen.
 */
fun totalAttentionCount(insights: List<PortfolioInsight>, awaitingConfirmationCount: Int = 0): Int =
    insights.size + awaitingConfirmationCount

const val MAX_DASHBOARD_ATTENTION_ITEMS = 4
