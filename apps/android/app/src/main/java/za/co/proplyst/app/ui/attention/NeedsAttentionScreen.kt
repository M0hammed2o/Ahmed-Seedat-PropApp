package za.co.proplyst.app.ui.attention

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.lifecycle.compose.LifecycleResumeEffect
import za.co.proplyst.app.data.insights.AttentionMember
import za.co.proplyst.app.navigation.AttentionDestination
import za.co.proplyst.app.navigation.destinationForAttentionItem
import za.co.proplyst.app.navigation.destinationForMember
import za.co.proplyst.app.data.insights.AttentionCategory
import za.co.proplyst.app.data.insights.AttentionItem
import za.co.proplyst.app.data.insights.AttentionSeverity
import za.co.proplyst.app.data.insights.groupInsights
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.navyHeaderGlow
import za.co.proplyst.app.ui.dashboard.DashboardViewModel
import za.co.proplyst.app.ui.dashboard.FinancialSummaryUiState
import za.co.proplyst.app.ui.dashboard.InsightsUiState
import za.co.proplyst.app.ui.theme.ProplystTheme

/**
 * The full Needs-attention list, reached from Owner Home's bounded preview ("View all 417").
 *
 * Android UX pass (2026-09-08). Deliberately NOT a new alert system: it reads the very same
 * PortfolioInsightsRepository feed the dashboard does, through the same DashboardViewModel, and
 * reuses AttentionPresentation's grouping and ordering. Home shows the top few; this screen shows
 * everything, filterable.
 */

/** Filter tabs. ALL and CRITICAL are cross-cutting; the rest map to AttentionCategory. */
private enum class AttentionFilter(val label: String, val category: AttentionCategory?) {
    ALL("All", null),
    CRITICAL("Critical", null),
    PAYMENTS("Payments", AttentionCategory.PAYMENTS),
    RENT("Rent", AttentionCategory.RENT),
    BUDGET("Budget", AttentionCategory.BUDGET),
    UTILITIES("Utilities", AttentionCategory.UTILITIES),
    MAINTENANCE("Maintenance", AttentionCategory.MAINTENANCE),
    LEASE("Lease", AttentionCategory.LEASE),
}

@Composable
fun NeedsAttentionScreen(
    onBack: () -> Unit,
    /** Opens the record behind an alert. */
    onOpenRoute: (String) -> Unit = {},
    /** Category name to pre-select, supplied by Home when a grouped preview row is tapped. */
    initialCategory: String? = null,
    viewModel: DashboardViewModel = hiltViewModel(),
) {
    val insightsState by viewModel.insightsUiState.collectAsState()
    val financialSummaryState by viewModel.financialSummaryUiState.collectAsState()
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type

    // An alert is resolved by fixing the thing it complains about, never by being looked at. So
    // returning here -- from a confirmed payment, a closed ticket, a recorded payment -- must
    // re-ask the server rather than trusting whatever this screen last rendered. This is also what
    // keeps the header badge honest: it is recomputed from the refreshed feed, never decremented
    // locally.
    LifecycleResumeEffect(Unit) {
        viewModel.refresh()
        onPauseOrDispose { }
    }

    // Both of these survive process recreation, which is the whole reason they are held as a String
    // and a List<String> rather than as an enum and a Set: rememberSaveable can only put
    // Bundle-storable values away, and an owner who gets a call mid-review should come back to the
    // filter and the expanded group they left, not to a reset screen.
    var filterName by rememberSaveable {
        mutableStateOf(
            (AttentionFilter.entries.firstOrNull { it.category?.name == initialCategory }
                ?: AttentionFilter.ALL).name,
        )
    }
    val filter = AttentionFilter.entries.firstOrNull { it.name == filterName } ?: AttentionFilter.ALL

    // Which grouped rows the user has opened, keyed by the same identity the LazyColumn uses.
    var expandedKeys by rememberSaveable { mutableStateOf(emptyList<String>()) }

    val insights = (insightsState as? InsightsUiState.Loaded)?.insights.orEmpty()
    val awaiting = (financialSummaryState as? FinancialSummaryUiState.Loaded)?.summary?.awaitingConfirmationCount ?: 0
    val all = groupInsights(insights, awaiting)
    val shown = when (filter) {
        AttentionFilter.ALL -> all
        AttentionFilter.CRITICAL -> all.filter { it.severity == AttentionSeverity.CRITICAL }
        else -> all.filter { it.category == filter.category }
    }
    val total = insights.size + awaiting

    Column(modifier = Modifier.fillMaxSize().background(colors.background)) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.navy)
                .navyHeaderGlow()
                .statusBarsPadding()
                .padding(bottom = 16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp)) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back", tint = Color.White)
                }
                Text("Needs attention", style = type.settingsTitle, color = Color.White)
                if (total > 0) {
                    Spacer(modifier = Modifier.width(8.dp))
                    Surface(color = Color.White.copy(alpha = 0.18f), shape = RoundedCornerShape(50)) {
                        Text(
                            "$total",
                            style = type.meta.copy(fontWeight = FontWeight.Bold),
                            color = Color.White,
                            modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.dp),
                        )
                    }
                }
            }
            Row(
                modifier = Modifier.padding(top = 6.dp, start = 20.dp).horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                AttentionFilter.entries.forEach { f ->
                    FilterChip(label = f.label, selected = f == filter) { filterName = f.name }
                }
                Spacer(modifier = Modifier.width(12.dp))
            }
        }

        when {
            insightsState is InsightsUiState.Loading ->
                CircularProgressIndicator(modifier = Modifier.padding(24.dp).size(24.dp))
            insightsState is InsightsUiState.Error ->
                EmptyStateView(
                    title = "Couldn't load alerts",
                    description = (insightsState as InsightsUiState.Error).message,
                    modifier = Modifier.fillMaxSize(),
                )
            shown.isEmpty() ->
                EmptyStateView(
                    title = if (filter == AttentionFilter.ALL) "Nothing needs attention" else "Nothing under ${filter.label}",
                    description = if (filter == AttentionFilter.ALL) {
                        "Your portfolio is up to date."
                    } else {
                        "Try another filter to see the rest."
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            else -> LazyColumn(
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(shown, key = { it.category.name + it.severity.name }) { item ->
                    val rowKey = item.category.name + item.severity.name
                    val isExpanded = rowKey in expandedKeys
                    val destination = destinationForAttentionItem(item)
                    AttentionDetailRow(
                        item = item,
                        expanded = isExpanded,
                        // A group with no list screen of its own expands here; everything else
                        // leads somewhere, and only a genuinely unresolvable row stays inert.
                        expandable = destination is AttentionDestination.Expand,
                        hasDestination = destination is AttentionDestination.Route,
                        onClick = {
                            when (destination) {
                                is AttentionDestination.Route -> onOpenRoute(destination.route)
                                is AttentionDestination.Expand ->
                                    expandedKeys =
                                        if (isExpanded) expandedKeys - rowKey else expandedKeys + rowKey

                                is AttentionDestination.None -> Unit
                            }
                        },
                    )
                    if (isExpanded) {
                        item.members.forEach { member ->
                            val memberDestination = destinationForMember(member)
                            AttentionMemberRow(
                                member = member,
                                hasDestination = memberDestination is AttentionDestination.Route,
                                onClick = {
                                    (memberDestination as? AttentionDestination.Route)
                                        ?.let { onOpenRoute(it.route) }
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val type = ProplystTheme.type
    Surface(
        color = if (selected) Color.White else Color.White.copy(alpha = 0.12f),
        shape = RoundedCornerShape(50),
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Text(
            label,
            style = type.statusLabel,
            color = if (selected) ProplystTheme.colors.navy else Color.White,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
        )
    }
}

/**
 * One alert row. The WHOLE card is the target -- the CRITICAL/WARNING/REVIEW label on the right is
 * a severity indicator, not a button, and was never the thing to aim at.
 */
@Composable
private fun AttentionDetailRow(
    item: AttentionItem,
    expanded: Boolean,
    expandable: Boolean,
    hasDestination: Boolean,
    onClick: () -> Unit,
) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val accent = when (item.severity) {
        AttentionSeverity.CRITICAL -> colors.critical
        AttentionSeverity.WARNING -> colors.warning
        AttentionSeverity.INFO -> colors.primary
    }
    Surface(
        color = colors.surface,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = expandable || hasDestination, onClick = onClick),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp, horizontal = 16.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(width = 4.dp, height = 40.dp)
                    .background(accent, RoundedCornerShape(2.dp)),
            )
            Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
                Text(
                    item.title,
                    style = type.cardTitle,
                    color = colors.textPrimary,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    // Plain language, never the raw insight_type.
                    if (item.count > 1) "${item.category.label} · ${item.count} items" else item.category.label,
                    style = type.meta,
                    color = colors.textSecondary,
                    maxLines = 1,
                )
            }
            Text(item.actionLabel, style = type.statusLabel, color = accent, modifier = Modifier.padding(start = 10.dp))
            if (expandable) {
                Icon(
                    if (expanded) Icons.Outlined.KeyboardArrowUp else Icons.Outlined.KeyboardArrowDown,
                    contentDescription = if (expanded) "Collapse" else "Show the individual records",
                    tint = colors.textSecondary,
                    modifier = Modifier.padding(start = 6.dp),
                )
            } else if (hasDestination) {
                Icon(
                    Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                    contentDescription = null,
                    tint = colors.textSecondary,
                    modifier = Modifier.padding(start = 6.dp),
                )
            }
        }
    }
}

/**
 * One underlying record inside an expanded group.
 *
 * Its message is shown in full -- no maxLines -- because this is exactly where a truncated card
 * title is supposed to become readable. Indented so it reads as belonging to the row above it.
 */
@Composable
private fun AttentionMemberRow(
    member: AttentionMember,
    hasDestination: Boolean,
    onClick: () -> Unit,
) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Surface(
        color = colors.background,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, top = 6.dp)
            .clickable(enabled = hasDestination, onClick = onClick),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp, horizontal = 14.dp),
        ) {
            Text(
                member.message,
                style = type.meta,
                color = colors.textPrimary,
                modifier = Modifier.weight(1f),
            )
            if (hasDestination) {
                Icon(
                    Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                    contentDescription = null,
                    tint = colors.textSecondary,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
        }
    }
}
