package za.co.proplyst.app.ui.dashboard

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.R
import za.co.proplyst.app.data.financials.FinancialSummary
import za.co.proplyst.app.data.insights.PortfolioInsight
import za.co.proplyst.app.data.notifications.AppNotification
import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.ui.common.PropertyPhoto
import za.co.proplyst.app.ui.common.formatCurrency
import za.co.proplyst.app.ui.common.navyHeaderGlow
import za.co.proplyst.app.ui.common.relativeTimeLabel
import za.co.proplyst.app.ui.theme.ProplystTheme
import java.time.LocalDate
import java.time.format.TextStyle as JTextStyle
import java.util.Locale

/**
 * Owner Home (fidelity audit §2, `B-OwnerHome.dc.html` platform=android) -- mark + wordmark
 * header with bordered bell (unread dot) and avatar, greeting, hero amount with inline %,
 * billed/outstanding row, the −44 dp KPI overlap card, Needs Attention severity rails, semantic
 * Recent Activity glyphs with relative timestamps, and the Top Properties strip. All values are
 * the same server-authoritative sources as before -- this pass changed presentation only.
 */
@Composable
fun DashboardScreen(
    onNotificationsClick: () -> Unit,
    onPropertyClick: (String) -> Unit,
    onAccountClick: () -> Unit,
    viewModel: DashboardViewModel = hiltViewModel(),
) {
    val insightsState by viewModel.insightsUiState.collectAsState()
    val summaryState by viewModel.summaryUiState.collectAsState()
    val financialSummaryState by viewModel.financialSummaryUiState.collectAsState()
    val topProperties by viewModel.topProperties.collectAsState()
    val recentActivity by viewModel.recentActivity.collectAsState()
    val hasUnread by viewModel.hasUnread.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(ProplystTheme.colors.background),
    ) {
        LazyColumn(modifier = Modifier.fillMaxSize()) {
            item {
                NavyHeroSection(
                    financialSummaryState = financialSummaryState,
                    hasUnread = hasUnread,
                    accountEmail = viewModel.accountEmail,
                    onNotificationsClick = onNotificationsClick,
                    onAccountClick = onAccountClick,
                )
            }
            item { KpiStrip(summaryState = summaryState, properties = topProperties) }
            item { Spacer(modifier = Modifier.height(24.dp)) }
            item { OperatingCostsSection(financialSummaryState = financialSummaryState) }
            item { Spacer(modifier = Modifier.height(24.dp)) }
            item { BudgetSection(financialSummaryState = financialSummaryState) }
            item { Spacer(modifier = Modifier.height(24.dp)) }
            item { OperatingPositionSection(financialSummaryState = financialSummaryState) }
            item { Spacer(modifier = Modifier.height(24.dp)) }
            item { NeedsAttentionSection(insightsState = insightsState, financialSummaryState = financialSummaryState) }
            item { Spacer(modifier = Modifier.height(24.dp)) }
            item { RecentActivitySection(activity = recentActivity) }
            item { Spacer(modifier = Modifier.height(24.dp)) }
            item { TopPropertiesSection(properties = topProperties, onPropertyClick = onPropertyClick) }
            item { Spacer(modifier = Modifier.height(110.dp)) }
        }
    }
}

private fun greeting(): String {
    val hour = java.time.LocalTime.now().hour
    return when {
        hour < 12 -> "Good morning"
        hour < 18 -> "Good afternoon"
        else -> "Good evening"
    }
}

@Composable
private fun NavyHeroSection(
    financialSummaryState: FinancialSummaryUiState,
    hasUnread: Boolean,
    accountEmail: String?,
    onNotificationsClick: () -> Unit,
    onAccountClick: () -> Unit,
) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.navy)
            .navyHeaderGlow()
            .statusBarsPadding()
            .padding(bottom = 64.dp),
    ) {
        Column(modifier = Modifier.padding(top = 10.dp, start = 20.dp, end = 20.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Image(
                        painter = painterResource(R.drawable.proplyst_logo_mark),
                        contentDescription = null,
                        modifier = Modifier.height(26.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Prop", style = type.wordmark, color = Color.White)
                    Text("lyst", style = type.wordmark, color = colors.primaryLightOnNavy)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .size(40.dp)
                                .background(Color.White.copy(alpha = 0.06f), CircleShape)
                                .border(1.dp, Color.White.copy(alpha = 0.14f), CircleShape)
                                .clickable(onClick = onNotificationsClick),
                        ) {
                            Icon(
                                Icons.Outlined.Notifications,
                                contentDescription = "Notifications",
                                tint = Color.White,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                        if (hasUnread) {
                            Box(
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .offset(x = (-6).dp, y = 6.dp)
                                    .size(9.dp)
                                    .background(colors.primaryLightOnNavy, CircleShape)
                                    .border(2.dp, colors.navy, CircleShape),
                            )
                        }
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .size(40.dp)
                            .background(colors.primary, CircleShape)
                            .clickable(onClick = onAccountClick),
                    ) {
                        Text(
                            accountEmail?.firstOrNull()?.uppercase() ?: "•",
                            style = type.captionEmphasis.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold),
                            color = Color.White,
                        )
                    }
                }
            }
            Spacer(modifier = Modifier.height(20.dp))
            Text(greeting(), style = type.body, color = colors.navySecondaryOn)
            val monthLabel = financialSummaryMonthLabel(financialSummaryState)
            Text(
                "Collected$monthLabel",
                style = type.caption,
                color = colors.navySecondaryOn,
                modifier = Modifier.padding(top = 2.dp),
            )
            when (financialSummaryState) {
                is FinancialSummaryUiState.Loaded -> {
                    val summary = financialSummaryState.summary
                    val pct = if (summary.rentPlanned > 0) (summary.rentCollected / summary.rentPlanned * 100).coerceIn(0.0, 100.0) else 0.0
                    Text(
                        "R ${formatCurrency(summary.rentCollected)}",
                        style = type.financialHero,
                        color = Color.White,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    Spacer(modifier = Modifier.height(14.dp))
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .height(6.dp)
                                .clip(RoundedCornerShape(50))
                                .background(Color.White.copy(alpha = 0.14f)),
                        ) {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth((pct / 100.0).toFloat())
                                    .height(6.dp)
                                    .background(colors.primaryLightOnNavy, RoundedCornerShape(50)),
                            )
                        }
                        Spacer(modifier = Modifier.width(10.dp))
                        Text("${"%.0f".format(pct)}%", style = type.captionEmphasis.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold), color = colors.primaryLightOnNavy)
                    }
                    Spacer(modifier = Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Billed ", style = type.caption, color = colors.navySecondaryOn)
                        Text("R ${formatCurrency(summary.rentPlanned)}", style = type.captionEmphasis, color = Color.White)
                        Spacer(modifier = Modifier.width(18.dp))
                        Text("Outstanding ", style = type.caption, color = colors.navySecondaryOn)
                        Text("R ${formatCurrency(summary.rentOutstanding)}", style = type.captionEmphasis, color = colors.outstandingOnNavy)
                    }
                }
                is FinancialSummaryUiState.Loading -> CircularProgressIndicator(
                    color = Color.White,
                    modifier = Modifier.padding(top = 12.dp).size(28.dp),
                )
                is FinancialSummaryUiState.Empty -> Text(
                    "No billing summary yet this period.",
                    style = type.body,
                    color = colors.navyTertiaryOn,
                    modifier = Modifier.padding(top = 8.dp),
                )
                is FinancialSummaryUiState.Error -> Text(
                    financialSummaryState.message,
                    style = type.body,
                    color = colors.outstandingOnNavy,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }
}

private fun financialSummaryMonthLabel(state: FinancialSummaryUiState): String {
    val month = (state as? FinancialSummaryUiState.Loaded)?.summary?.month ?: return ""
    return try {
        val date = LocalDate.parse(month)
        " in ${date.month.getDisplayName(JTextStyle.FULL, Locale.getDefault())}"
    } catch (_: Exception) {
        ""
    }
}

@Composable
private fun KpiStrip(summaryState: OwnerSummaryUiState, properties: List<Property>) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val summary = (summaryState as? OwnerSummaryUiState.Loaded)?.summary
    // Real occupancy across the properties this account can see (unitCount/occupiedUnitCount are
    // the real, backend-computed counts) -- never fabricated; "—" only with zero units.
    val totalUnits = properties.sumOf { it.unitCount }
    val occupiedUnits = properties.sumOf { it.occupiedUnitCount }
    val occupancyLabel = if (totalUnits > 0) "${occupiedUnits * 100 / totalUnits}%" else "—"
    val openJobs = summary?.openMaintenanceCount
    Surface(
        color = colors.surface,
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .offset(y = (-44).dp)
            .shadow(8.dp, RoundedCornerShape(18.dp), ambientColor = colors.navy.copy(alpha = 0.10f), spotColor = colors.navy.copy(alpha = 0.10f)),
    ) {
        Row(modifier = Modifier.padding(vertical = 14.dp, horizontal = 6.dp)) {
            KpiColumn("Occupancy", occupancyLabel, Modifier.weight(1f))
            KpiDivider()
            KpiColumn("Properties", summary?.propertyCount?.toString() ?: properties.size.toString(), Modifier.weight(1f))
            KpiDivider()
            KpiColumn(
                "Open jobs",
                openJobs?.toString() ?: "—",
                Modifier.weight(1f),
                valueColor = if ((openJobs ?: 0) > 0) colors.warning else null,
            )
            KpiDivider()
            KpiColumn("Expiring", summary?.upcomingLeaseExpiryCount?.toString() ?: "—", Modifier.weight(1f))
        }
    }
}

@Composable
private fun KpiDivider() {
    Box(
        modifier = Modifier
            .width(1.dp)
            .height(40.dp)
            .background(ProplystTheme.colors.divider),
    )
}

@Composable
private fun KpiColumn(label: String, value: String, modifier: Modifier = Modifier, valueColor: Color? = null) {
    val colors = ProplystTheme.colors
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = ProplystTheme.type.kpiValue, color = valueColor ?: colors.textPrimary)
        Text(
            label,
            style = ProplystTheme.type.chipLabel.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Normal),
            color = colors.textSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 3.dp),
        )
    }
}

/** UTILITIES_RATES_BUDGET_IMPLEMENTATION.md "Owner Home mobile" -- Utilities/Rates & levies/Other/
 * Total, from the same live portfolio financial summary the hero card reads. Loading/error states
 * are already shown on the hero card above; this section renders nothing extra for those (avoiding
 * two duplicate spinners/error banners on one screen) and simply waits for Loaded. */
@Composable
private fun OperatingCostsSection(financialSummaryState: FinancialSummaryUiState) {
    val summary = (financialSummaryState as? FinancialSummaryUiState.Loaded)?.summary ?: return
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Column(modifier = Modifier.padding(horizontal = 20.dp)) {
        Text("Operating costs", style = type.sectionHeading, color = colors.textPrimary)
        Spacer(modifier = Modifier.height(12.dp))
        Surface(
            color = colors.surface,
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .shadow(1.dp, RoundedCornerShape(16.dp), ambientColor = colors.navy.copy(alpha = 0.10f), spotColor = colors.navy.copy(alpha = 0.10f)),
        ) {
            Column(modifier = Modifier.padding(vertical = 4.dp)) {
                ExpenseLineRow("Utilities", summary.utilitiesExpense)
                DividerLine()
                ExpenseLineRow("Rates & levies", summary.ratesAndLeviesExpense)
                DividerLine()
                ExpenseLineRow("Other expenses", summary.otherExpenses)
                DividerLine()
                ExpenseLineRow("Total expenses", summary.totalExpenses, emphasize = true)
            }
        }
    }
}

@Composable
private fun ExpenseLineRow(label: String, amount: Double, emphasize: Boolean = false) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp, horizontal = 16.dp),
    ) {
        Text(
            label,
            style = if (emphasize) type.cardTitle.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold) else type.body,
            color = if (emphasize) colors.textPrimary else colors.textSecondary,
        )
        Text(
            "R ${formatCurrency(amount)}",
            style = if (emphasize) type.cardTitle.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold) else type.captionEmphasis,
            color = colors.textPrimary,
        )
    }
}

@Composable
private fun DividerLine() {
    Box(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(1.dp).background(ProplystTheme.colors.divider))
}

/** Monthly budget -- planned/used/remaining/%, plus a slim progress bar coloured to match the
 * approaching/exceeded thresholds (§4A: 80% approaching, 100% exceeded). Renders nothing when no
 * budget is set for this portfolio+month (budgetPlanned is null) -- an owner who hasn't set a
 * budget yet should not see an empty/zeroed budget card implying one exists. */
@Composable
private fun BudgetSection(financialSummaryState: FinancialSummaryUiState) {
    val summary = (financialSummaryState as? FinancialSummaryUiState.Loaded)?.summary ?: return
    val planned = summary.budgetPlanned ?: return
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val pct = (summary.budgetUsedPercent ?: 0.0).coerceIn(0.0, 999.0)
    val barColor = when {
        pct >= 100.0 -> colors.critical
        pct >= 80.0 -> colors.warning
        else -> colors.primary
    }
    Column(modifier = Modifier.padding(horizontal = 20.dp)) {
        Text("Budget", style = type.sectionHeading, color = colors.textPrimary)
        Spacer(modifier = Modifier.height(12.dp))
        Surface(
            color = colors.surface,
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .shadow(1.dp, RoundedCornerShape(16.dp), ambientColor = colors.navy.copy(alpha = 0.10f), spotColor = colors.navy.copy(alpha = 0.10f)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    Text("R ${formatCurrency(summary.totalExpenses)} of R ${formatCurrency(planned)}", style = type.cardTitle, color = colors.textPrimary)
                    Text("${"%.1f".format(pct)}%", style = type.cardTitle.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold), color = barColor)
                }
                Spacer(modifier = Modifier.height(10.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(6.dp)
                        .clip(RoundedCornerShape(50))
                        .background(colors.divider),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth((pct / 100.0).coerceIn(0.0, 1.0).toFloat())
                            .height(6.dp)
                            .background(barColor, RoundedCornerShape(50)),
                    )
                }
                Spacer(modifier = Modifier.height(10.dp))
                Text(
                    if ((summary.budgetRemaining ?: 0.0) >= 0)
                        "R ${formatCurrency(summary.budgetRemaining ?: 0.0)} remaining"
                    else
                        "R ${formatCurrency(-(summary.budgetRemaining ?: 0.0))} over budget",
                    style = type.meta,
                    color = colors.textSecondary,
                )
            }
        }
    }
}

/** "Monthly net position" -- rent collected minus owner operating expenses. Deliberately never
 * labelled "profit" (excludes tax, finance costs, depreciation, management fee) -- see this
 * screen's own note and UTILITIES_RATES_BUDGET_IMPLEMENTATION.md. */
@Composable
private fun OperatingPositionSection(financialSummaryState: FinancialSummaryUiState) {
    val summary = (financialSummaryState as? FinancialSummaryUiState.Loaded)?.summary ?: return
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val positive = summary.netOperatingPosition >= 0
    Column(modifier = Modifier.padding(horizontal = 20.dp)) {
        Text("Monthly net position", style = type.sectionHeading, color = colors.textPrimary)
        Spacer(modifier = Modifier.height(12.dp))
        Surface(
            color = colors.surface,
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .shadow(1.dp, RoundedCornerShape(16.dp), ambientColor = colors.navy.copy(alpha = 0.10f), spotColor = colors.navy.copy(alpha = 0.10f)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    "${if (positive) "R" else "-R"} ${formatCurrency(kotlin.math.abs(summary.netOperatingPosition))}",
                    style = type.pageTitle,
                    color = if (positive) colors.successText else colors.criticalDeep,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    "Rent collected minus operating expenses this month. Not accounting profit -- excludes tax, finance costs, and depreciation.",
                    style = type.caption,
                    color = colors.textSecondary,
                )
            }
        }
    }
}

@Composable
private fun NeedsAttentionSection(insightsState: InsightsUiState, financialSummaryState: FinancialSummaryUiState) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val insights = (insightsState as? InsightsUiState.Loaded)?.insights.orEmpty()
    val awaitingConfirmation = (financialSummaryState as? FinancialSummaryUiState.Loaded)?.summary?.awaitingConfirmationCount ?: 0
    val totalCount = insights.size + (if (awaitingConfirmation > 0) 1 else 0)
    if (insightsState is InsightsUiState.Empty && awaitingConfirmation == 0) return
    Column(modifier = Modifier.padding(horizontal = 20.dp)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Needs attention", style = type.sectionHeading, color = colors.textPrimary)
            if (totalCount > 0) {
                Surface(color = colors.navy, shape = RoundedCornerShape(50)) {
                    Text(
                        "$totalCount",
                        style = type.meta.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold),
                        color = Color.White,
                        modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.dp),
                    )
                }
            }
        }
        Spacer(modifier = Modifier.height(12.dp))
        when (insightsState) {
            is InsightsUiState.Loading -> CircularProgressIndicator(modifier = Modifier.size(24.dp))
            is InsightsUiState.Error -> Text(insightsState.message, style = type.caption, color = colors.critical)
            else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                // Payment-awaiting-confirmation is a LIVE count from the same financial-summary
                // call (never a stale daily-job insight -- a tenant's just-reported payment should
                // show up immediately, not tomorrow), rendered first since it is directly
                // actionable from this screen's own Payment Review entry point.
                if (awaitingConfirmation > 0) {
                    AwaitingConfirmationRow(count = awaitingConfirmation)
                }
                insights.forEach { InsightRow(it) }
            }
        }
    }
}

@Composable
private fun AwaitingConfirmationRow(count: Int) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Surface(
        color = colors.surface,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier
            .fillMaxWidth()
            .shadow(1.dp, RoundedCornerShape(16.dp), ambientColor = colors.navy.copy(alpha = 0.10f), spotColor = colors.navy.copy(alpha = 0.10f)),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp, horizontal = 16.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(width = 4.dp, height = 36.dp)
                    .background(colors.primary, RoundedCornerShape(2.dp)),
            )
            Text(
                if (count == 1) "1 payment is awaiting your confirmation." else "$count payments are awaiting your confirmation.",
                style = type.cardTitle,
                color = colors.textPrimary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = 12.dp).weight(1f),
            )
            Text("REVIEW", style = type.statusLabel, color = colors.primary, modifier = Modifier.padding(start = 10.dp))
        }
    }
}

@Composable
private fun InsightRow(insight: PortfolioInsight) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val (railColor, label) = when (insight.severity) {
        "urgent" -> colors.critical to "CRITICAL"
        "warning" -> colors.warning to "HIGH"
        else -> colors.primary to "MEDIUM"
    }
    Surface(
        color = colors.surface,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier
            .fillMaxWidth()
            .shadow(1.dp, RoundedCornerShape(16.dp), ambientColor = colors.navy.copy(alpha = 0.10f), spotColor = colors.navy.copy(alpha = 0.10f)),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp, horizontal = 16.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(width = 4.dp, height = 36.dp)
                    .background(railColor, RoundedCornerShape(2.dp)),
            )
            Text(
                insight.message,
                style = type.cardTitle,
                color = colors.textPrimary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = 12.dp).weight(1f),
            )
            Text(
                label,
                style = type.statusLabel,
                color = railColor,
                modifier = Modifier.padding(start = 10.dp),
            )
        }
    }
}

@Composable
private fun RecentActivitySection(activity: List<AppNotification>) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    if (activity.isEmpty()) return
    Column(modifier = Modifier.padding(horizontal = 20.dp)) {
        Text("Recent activity", style = type.sectionHeading, color = colors.textPrimary)
        Spacer(modifier = Modifier.height(12.dp))
        Surface(
            color = colors.surface,
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .shadow(1.dp, RoundedCornerShape(16.dp), ambientColor = colors.navy.copy(alpha = 0.10f), spotColor = colors.navy.copy(alpha = 0.10f)),
        ) {
            Column(modifier = Modifier.padding(vertical = 4.dp)) {
                activity.forEachIndexed { index, notification ->
                    ActivityRow(notification)
                    if (index != activity.lastIndex) {
                        Box(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(1.dp).background(colors.divider))
                    }
                }
            }
        }
    }
}

/** Semantic glyph tint per notification type (fidelity audit §2). */
private data class ActivityGlyph(val bg: Color, val tint: Color, val icon: androidx.compose.ui.graphics.vector.ImageVector)

@Composable
private fun activityGlyph(type: String): ActivityGlyph = when {
    type.startsWith("payment") -> ActivityGlyph(Color(0xFFDCFCE7), Color(0xFF15803D), Icons.Outlined.Payments)
    type.startsWith("invoice") -> ActivityGlyph(ProplystTheme.colors.blueTint, ProplystTheme.colors.primary, Icons.Outlined.Description)
    type.startsWith("maintenance") -> ActivityGlyph(Color(0xFFFEF3C7), Color(0xFFB45309), Icons.Outlined.Build)
    type.startsWith("lease") -> ActivityGlyph(Color(0xFFDCFCE7), Color(0xFF15803D), Icons.Outlined.Description)
    else -> ActivityGlyph(ProplystTheme.colors.blueTint, ProplystTheme.colors.primary, Icons.Outlined.Notifications)
}

@Composable
private fun ActivityRow(notification: AppNotification) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val glyph = activityGlyph(notification.type)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp, horizontal = 16.dp),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.size(34.dp).background(glyph.bg, RoundedCornerShape(10.dp)),
        ) {
            Icon(glyph.icon, contentDescription = null, tint = glyph.tint, modifier = Modifier.size(16.dp))
        }
        Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
            Text(
                notification.title,
                style = type.bodySmall.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold),
                color = colors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (!notification.body.isNullOrBlank()) {
                Text(
                    notification.body,
                    style = type.meta,
                    color = colors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
        Text(
            relativeTimeLabel(notification.createdAt),
            style = type.meta,
            color = colors.textTertiary,
            modifier = Modifier.padding(start = 10.dp),
        )
    }
}

@Composable
private fun TopPropertiesSection(properties: List<Property>, onPropertyClick: (String) -> Unit) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    if (properties.isEmpty()) return
    Column {
        Text(
            "Top properties",
            style = type.sectionHeading,
            color = colors.textPrimary,
            modifier = Modifier.padding(horizontal = 20.dp),
        )
        Spacer(modifier = Modifier.height(12.dp))
        LazyRow(
            contentPadding = PaddingValues(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(properties, key = { it.id }) { property ->
                Box(
                    modifier = Modifier
                        .size(width = 170.dp, height = 120.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .clickable { onPropertyClick(property.id) },
                ) {
                    PropertyPhoto(
                        imageUrl = property.coverPhotoUrl,
                        contentDescription = property.nickname,
                        modifier = Modifier.fillMaxSize(),
                    )
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(
                                Brush.verticalGradient(
                                    0.4f to Color.Transparent,
                                    1f to Color(0xFF0B1220).copy(alpha = 0.85f),
                                ),
                            ),
                    )
                    Column(modifier = Modifier.align(Alignment.BottomStart).padding(horizontal = 12.dp, vertical = 10.dp)) {
                        Text(
                            property.nickname,
                            style = type.captionEmphasis.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold),
                            color = Color.White,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        // Design shows a per-property income line; that aggregate isn't in the
                        // backend's card extras yet, so the real unit/occupancy figures stand in
                        // rather than a fabricated amount (audit §3's own fallback rule).
                        if (property.unitCount > 0) {
                            Text(
                                "${property.occupiedUnitCount}/${property.unitCount} units let",
                                style = type.meta,
                                color = colors.navyTertiaryOn,
                            )
                        }
                    }
                }
            }
        }
    }
}
