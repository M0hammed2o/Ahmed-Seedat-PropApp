package za.co.proplyst.app.ui.utilities

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.utilities.UtilityHistoryPoint
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.navyHeaderGlow
import za.co.proplyst.app.ui.theme.ProplystTheme

/** Owner Utility History (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §7, §9-F). Anomaly wording is
 * never "leak detected" -- always "unusual usage" with the reason, matching §4B/§7 exactly. */
@Composable
fun UtilityHistoryScreen(
    onBack: () -> Unit,
    viewModel: UtilityHistoryViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type

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
                Text("Utility history", style = type.settingsTitle, color = Color.White)
            }
            if (state.properties.size > 1) {
                Row(modifier = Modifier.padding(top = 6.dp, start = 20.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.properties.forEach { property ->
                        HeaderChip(property.nickname, property.id == state.selectedPropertyId) { viewModel.selectProperty(property.id) }
                    }
                }
            }
            Row(modifier = Modifier.padding(top = 10.dp, start = 20.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                HeaderChip("Water", state.utilityType == "water") { viewModel.selectUtilityType("water") }
                HeaderChip("Electricity", state.utilityType == "electricity") { viewModel.selectUtilityType("electricity") }
            }
            if (state.filteredMeters.size > 1) {
                Row(modifier = Modifier.padding(top = 10.dp, start = 20.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.filteredMeters.forEach { meter ->
                        HeaderChip(meter.meterNumber ?: "Meter", meter.id == state.selectedMeterId) { viewModel.selectMeter(meter.id) }
                    }
                }
            }
        }

        when {
            state.propertiesLoading || state.historyLoading -> CircularProgressIndicator(modifier = Modifier.padding(24.dp).size(24.dp))
            state.error != null -> Text(state.error ?: "", style = type.caption, color = colors.critical, modifier = Modifier.padding(20.dp))
            state.selectedMeterId == null -> EmptyStateView(
                title = "No meter for this selection",
                description = "Set up a ${state.utilityType} meter from Properties → Finances on the web app.",
                modifier = Modifier.fillMaxSize(),
            )
            state.history.isEmpty() -> EmptyStateView(
                title = "No readings yet",
                description = "History appears once readings are recorded for this meter.",
                modifier = Modifier.fillMaxSize(),
            )
            else -> LazyColumn(
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(state.history, key = { it.periodMonth }) { point ->
                    UtilityHistoryRow(point, unitOfMeasure = if (state.utilityType == "water") "L" else "kWh")
                }
            }
        }
    }
}

@Composable
private fun HeaderChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Surface(
        color = if (selected) Color.White else Color.White.copy(alpha = 0.08f),
        shape = RoundedCornerShape(999.dp),
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Text(label, style = type.chipLabel, color = if (selected) colors.navy else Color.White, modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp))
    }
}

@Composable
private fun UtilityHistoryRow(point: UtilityHistoryPoint, unitOfMeasure: String) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Surface(
        color = colors.surface,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Text(monthLabel(point.periodMonth), style = type.cardTitle.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
                Text(
                    point.consumption?.let { "%.1f %s".format(it, unitOfMeasure) } ?: "—",
                    style = type.cardTitle.copy(fontWeight = FontWeight.Bold),
                    color = colors.textPrimary,
                )
            }
            if (point.percentChange != null || point.previousConsumption != null) {
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        point.previousConsumption?.let { "Previous: %.1f %s".format(it, unitOfMeasure) } ?: "First reading",
                        style = type.caption,
                        color = colors.textSecondary,
                    )
                    point.percentChange?.let {
                        Text(
                            "${if (it >= 0) "+" else ""}${"%.1f".format(it)}%",
                            style = type.captionEmphasis,
                            color = if (it > 0) colors.warningDeep else colors.successText,
                        )
                    }
                }
            }
            if (point.isUnusualUsage) {
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.WarningAmber, contentDescription = null, tint = colors.warningDeep, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "Unusual usage -- consider reviewing for a possible leak or abnormal consumption.",
                        style = type.caption,
                        color = colors.warningDeep,
                    )
                }
            }
        }
    }
}

private fun monthLabel(periodMonth: String): String {
    return try {
        val date = java.time.LocalDate.parse(periodMonth)
        date.month.getDisplayName(java.time.format.TextStyle.FULL, java.util.Locale.getDefault()) + " " + date.year
    } catch (_: Exception) {
        periodMonth
    }
}
