package za.co.proplyst.app.ui.dashboard

import androidx.compose.foundation.background
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
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.insights.PortfolioInsight
import za.co.proplyst.app.data.notifications.AppNotification
import za.co.proplyst.app.data.ownersummary.OwnerSummary
import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.ui.common.PropertyPhoto
import za.co.proplyst.app.ui.common.formatCurrency
import za.co.proplyst.app.ui.theme.ProplystTheme
import java.time.LocalDate
import java.time.format.TextStyle as JTextStyle
import java.util.Locale

/**
 * Owner Home (Proplyst Mobile Design System redesign pass, approved Navy Deck direction) -- the
 * single most important Owner screen (design handoff §"Owner Home"). Navy hero card with the
 * caller's current collected/billed/outstanding position (server-computed, [DashboardViewModel
 * .summaryUiState], never recalculated here), a KPI strip, "Needs attention" (Portfolio
 * Intelligence, unchanged data source from the prior pass), "Recent activity" (the existing
 * notification feed, reused rather than duplicated), and a horizontal "Top properties" strip.
 *
 * "Manage subscription" (previously a Dashboard toolbar icon) moved to OwnerMoreScreen -- Home is
 * meant to open on the caller's portfolio status, not an administrative action.
 */
@Composable
fun DashboardScreen(
    onNotificationsClick: () -> Unit,
    onPropertyClick: (String) -> Unit,
    viewModel: DashboardViewModel = hiltViewModel(),
) {
    val insightsState by viewModel.insightsUiState.collectAsState()
    val summaryState by viewModel.summaryUiState.collectAsState()
    val topProperties by viewModel.topProperties.collectAsState()
    val recentActivity by viewModel.recentActivity.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        LazyColumn(modifier = Modifier.fillMaxSize()) {
            item {
                NavyHeroSection(
                    summaryState = summaryState,
                    onNotificationsClick = onNotificationsClick,
                )
            }
            item { KpiStrip(summaryState = summaryState, properties = topProperties) }
            item { Spacer(modifier = Modifier.height(20.dp)) }
            item { NeedsAttentionSection(insightsState = insightsState) }
            item { Spacer(modifier = Modifier.height(20.dp)) }
            item { RecentActivitySection(activity = recentActivity) }
            item { Spacer(modifier = Modifier.height(20.dp)) }
            item { TopPropertiesSection(properties = topProperties, onPropertyClick = onPropertyClick) }
            item { Spacer(modifier = Modifier.height(96.dp)) }
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
    summaryState: OwnerSummaryUiState,
    onNotificationsClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.radialGradient(
                    colors = listOf(ProplystTheme.colors.primary.copy(alpha = 0.35f), Color.Transparent),
                    center = Offset(x = 900f, y = -100f),
                    radius = 700f,
                ),
            )
            .background(ProplystTheme.colors.navy)
            .statusBarsPadding()
            .padding(bottom = 44.dp),
    ) {
        Column(modifier = Modifier.padding(top = 20.dp, start = 20.dp, end = 20.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ProplystWordmark()
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(
                        shape = CircleShape,
                        color = Color.White.copy(alpha = 0.08f),
                        modifier = Modifier.size(40.dp),
                    ) {
                        IconButton(onClick = onNotificationsClick) {
                            Icon(Icons.Filled.Notifications, contentDescription = "Notifications", tint = Color.White)
                        }
                    }
                }
            }
            Spacer(modifier = Modifier.height(20.dp))
            Text(greeting(), style = ProplystTheme.type.greeting, color = ProplystTheme.colors.navySecondaryOn)
            val monthLabel = summaryMonthLabel(summaryState)
            Text(
                "Collected$monthLabel",
                style = ProplystTheme.type.caption,
                color = ProplystTheme.colors.navyTertiaryOn,
                modifier = Modifier.padding(top = 6.dp),
            )
            when (summaryState) {
                is OwnerSummaryUiState.Loaded -> {
                    val summary = summaryState.summary
                    val pct = if (summary.expectedRent > 0) (summary.confirmedPaid / summary.expectedRent * 100).coerceIn(0.0, 100.0) else 0.0
                    Text(
                        "R${formatCurrency(summary.confirmedPaid)}",
                        style = ProplystTheme.type.financialHero,
                        color = Color.White,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    LinearProgressIndicator(
                        progress = { (pct / 100.0).toFloat() },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(6.dp)
                            .clip(RoundedCornerShape(50)),
                        color = ProplystTheme.colors.primaryLightOnNavy,
                        trackColor = Color.White.copy(alpha = 0.14f),
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            "${"%.0f".format(pct)}% of R${formatCurrency(summary.expectedRent)} billed",
                            style = ProplystTheme.type.caption,
                            color = ProplystTheme.colors.navyTertiaryOn,
                        )
                        Text(
                            "Outstanding R${formatCurrency(summary.outstanding)}",
                            style = ProplystTheme.type.captionEmphasis,
                            color = ProplystTheme.colors.outstandingOnNavy,
                        )
                    }
                }
                is OwnerSummaryUiState.Loading -> CircularProgressIndicator(
                    color = Color.White,
                    modifier = Modifier.padding(top = 12.dp).size(28.dp),
                )
                is OwnerSummaryUiState.Empty -> Text(
                    "No billing summary yet this period.",
                    style = ProplystTheme.type.body,
                    color = ProplystTheme.colors.navyTertiaryOn,
                    modifier = Modifier.padding(top = 8.dp),
                )
                is OwnerSummaryUiState.Error -> Text(
                    summaryState.message,
                    style = ProplystTheme.type.body,
                    color = ProplystTheme.colors.outstandingOnNavy,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }
}

private fun summaryMonthLabel(state: OwnerSummaryUiState): String {
    val periodStart = (state as? OwnerSummaryUiState.Loaded)?.summary?.periodStart ?: return ""
    return try {
        val date = LocalDate.parse(periodStart)
        " in ${date.month.getDisplayName(JTextStyle.FULL, Locale.getDefault())}"
    } catch (_: Exception) {
        ""
    }
}

@Composable
private fun ProplystWordmark() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Prop", style = MaterialTheme.typography.titleMedium, color = Color.White, fontWeight = FontWeight.Bold)
        Text("lyst", style = MaterialTheme.typography.titleMedium, color = ProplystTheme.colors.primaryLightOnNavy, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun KpiStrip(summaryState: OwnerSummaryUiState, properties: List<Property>) {
    val summary = (summaryState as? OwnerSummaryUiState.Loaded)?.summary
    // Real occupancy across the properties this account can see (unitCount/occupiedUnitCount are
    // the real, backend-computed counts from PostgrestPropertiesRepository's card-extras
    // enrichment) -- never fabricated; "—" only when there are genuinely zero units to divide by.
    val totalUnits = properties.sumOf { it.unitCount }
    val occupiedUnits = properties.sumOf { it.occupiedUnitCount }
    val occupancyLabel = if (totalUnits > 0) "${occupiedUnits * 100 / totalUnits}%" else "—"
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(18.dp),
        shadowElevation = 3.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .offset(y = (-44).dp),
    ) {
        Row(modifier = Modifier.padding(vertical = 16.dp)) {
            KpiColumn("Properties", if (summary != null) summary.propertyCount.toString() else properties.size.toString(), Modifier.weight(1f))
            KpiDivider()
            KpiColumn("Occupancy", occupancyLabel, Modifier.weight(1f))
            KpiDivider()
            KpiColumn("Maintenance", summary?.openMaintenanceCount?.toString() ?: "—", Modifier.weight(1f))
            KpiDivider()
            KpiColumn("Lease renewals", summary?.upcomingLeaseExpiryCount?.toString() ?: "—", Modifier.weight(1f))
        }
    }
}

@Composable
private fun KpiDivider() {
    Box(
        modifier = Modifier
            .width(1.dp)
            .height(32.dp)
            .background(ProplystTheme.colors.divider),
    )
}

@Composable
private fun KpiColumn(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
        Text(
            label,
            style = ProplystTheme.type.caption,
            color = ProplystTheme.colors.textSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}

@Composable
private fun NeedsAttentionSection(insightsState: InsightsUiState) {
    val insights = (insightsState as? InsightsUiState.Loaded)?.insights.orEmpty()
    if (insightsState is InsightsUiState.Empty) return
    Column(modifier = Modifier.padding(horizontal = 20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Needs attention", style = ProplystTheme.type.sectionHeading)
            if (insights.isNotEmpty()) {
                Spacer(modifier = Modifier.width(8.dp))
                Surface(color = ProplystTheme.colors.navy, shape = RoundedCornerShape(50)) {
                    Text(
                        "${insights.size}",
                        style = ProplystTheme.type.statusLabel,
                        color = Color.White,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                    )
                }
            }
        }
        Spacer(modifier = Modifier.height(10.dp))
        when (insightsState) {
            is InsightsUiState.Loading -> CircularProgressIndicator(modifier = Modifier.size(24.dp))
            is InsightsUiState.Error -> Text(insightsState.message, style = ProplystTheme.type.caption, color = ProplystTheme.colors.critical)
            else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                insights.forEach { InsightRow(it) }
            }
        }
    }
}

@Composable
private fun InsightRow(insight: PortfolioInsight) {
    val (barColor, label) = when (insight.severity) {
        "urgent" -> ProplystTheme.colors.critical to "CRITICAL"
        "warning" -> ProplystTheme.colors.warning to "HIGH"
        else -> ProplystTheme.colors.primary to "MEDIUM"
    }
    Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(16.dp), shadowElevation = 1.dp) {
        Row(modifier = Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(width = 4.dp, height = 36.dp)
                    .background(barColor, RoundedCornerShape(2.dp)),
            )
            Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
                Text(insight.message, style = ProplystTheme.type.body, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(label, style = ProplystTheme.type.statusLabel, color = barColor, modifier = Modifier.padding(top = 2.dp))
            }
        }
    }
}

@Composable
private fun RecentActivitySection(activity: List<AppNotification>) {
    if (activity.isEmpty()) return
    Column(modifier = Modifier.padding(horizontal = 20.dp)) {
        Text("Recent activity", style = ProplystTheme.type.sectionHeading)
        Spacer(modifier = Modifier.height(10.dp))
        Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(16.dp), shadowElevation = 1.dp) {
            Column {
                activity.forEachIndexed { index, notification ->
                    ActivityRow(notification)
                    if (index != activity.lastIndex) {
                        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(ProplystTheme.colors.divider))
                    }
                }
            }
        }
    }
}

@Composable
private fun ActivityRow(notification: AppNotification) {
    Row(modifier = Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(34.dp)
                .background(ProplystTheme.colors.blueTint, RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Filled.Notifications,
                contentDescription = null,
                tint = ProplystTheme.colors.primary,
                modifier = Modifier.size(16.dp),
            )
        }
        Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
            Text(notification.title, style = ProplystTheme.type.cardTitle.copy(fontSize = 14.sp), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!notification.body.isNullOrBlank()) {
                Text(
                    notification.body,
                    style = ProplystTheme.type.caption,
                    color = ProplystTheme.colors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
    }
}

@Composable
private fun TopPropertiesSection(properties: List<Property>, onPropertyClick: (String) -> Unit) {
    if (properties.isEmpty()) return
    Column {
        Text("Top properties", style = ProplystTheme.type.sectionHeading, modifier = Modifier.padding(horizontal = 20.dp))
        Spacer(modifier = Modifier.height(10.dp))
        LazyRow(
            contentPadding = PaddingValues(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(properties, key = { it.id }) { property ->
                Column(
                    modifier = Modifier
                        .width(170.dp)
                        .clickable { onPropertyClick(property.id) },
                ) {
                    Box(modifier = Modifier.size(width = 170.dp, height = 120.dp)) {
                        PropertyPhoto(
                            imageUrl = property.coverPhotoUrl,
                            contentDescription = property.nickname,
                            modifier = Modifier.fillMaxSize(),
                            shape = RoundedCornerShape(16.dp),
                        )
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(
                                    Brush.verticalGradient(
                                        0.4f to Color.Transparent,
                                        1f to ProplystTheme.colors.navy.copy(alpha = 0.85f),
                                    ),
                                    RoundedCornerShape(16.dp),
                                ),
                        )
                        Text(
                            property.nickname,
                            style = ProplystTheme.type.cardTitle.copy(fontSize = 13.sp),
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.align(Alignment.BottomStart).padding(10.dp),
                        )
                    }
                }
            }
        }
    }
}
