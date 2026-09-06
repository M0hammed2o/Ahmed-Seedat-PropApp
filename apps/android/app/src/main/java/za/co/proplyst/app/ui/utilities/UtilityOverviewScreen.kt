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
import androidx.compose.material.icons.outlined.ElectricBolt
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.WaterDrop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.formatCurrency
import za.co.proplyst.app.ui.common.navyHeaderGlow
import za.co.proplyst.app.ui.theme.ProplystTheme

/** Owner Utility Overview (V1 owner-app completion pass, WORKLOG.md this date) -- the "how are my
 * meters doing" daily-use screen the prior Android pass disclosed as missing. Distinct from
 * Utility Capture (record a reading) and Utility History (one meter's full trend), both of which
 * this screen links out to rather than duplicating. Anomaly wording matches the established rule
 * (UtilityHistoryScreen.kt, UTILITIES_RATES_BUDGET_GAP_AUDIT.md §4B/§7): never "Leak detected". */
@Composable
fun UtilityOverviewScreen(
    onBack: () -> Unit,
    onRecordReading: () -> Unit,
    onViewHistory: () -> Unit,
    viewModel: UtilityOverviewViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
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
                Text("Utility overview", style = type.settingsTitle, color = Color.White)
            }
            if (state.properties.size > 1) {
                Row(
                    modifier = Modifier.padding(top = 6.dp, start = 20.dp).horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    state.properties.forEach { property ->
                        PropertyChip(property.nickname, property.id == state.selectedPropertyId) { viewModel.selectProperty(property.id) }
                    }
                }
            }
        }

        when {
            state.propertiesLoading -> CircularProgressIndicator(modifier = Modifier.padding(24.dp).size(24.dp))
            state.error != null -> EmptyStateView(title = "Couldn't load utilities", description = state.error ?: "", modifier = Modifier.fillMaxSize())
            else -> LazyColumn(
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                item {
                    UtilitySection(
                        label = "Water",
                        icon = Icons.Outlined.WaterDrop,
                        unitOfMeasure = "L",
                        cards = state.waterMeters,
                        ownerCostThisMonth = state.waterExpenseThisMonth,
                        loading = state.metersLoading,
                        onRecordReading = onRecordReading,
                        onViewHistory = onViewHistory,
                    )
                }
                item {
                    UtilitySection(
                        label = "Electricity",
                        icon = Icons.Outlined.ElectricBolt,
                        unitOfMeasure = "kWh",
                        cards = state.electricityMeters,
                        ownerCostThisMonth = state.electricityExpenseThisMonth,
                        loading = state.metersLoading,
                        onRecordReading = onRecordReading,
                        onViewHistory = onViewHistory,
                    )
                }
                item { Spacer(modifier = Modifier.height(80.dp)) }
            }
        }
    }
}

@Composable
private fun PropertyChip(label: String, selected: Boolean, onClick: () -> Unit) {
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
private fun UtilitySection(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    unitOfMeasure: String,
    cards: List<UtilityMeterCard>,
    ownerCostThisMonth: Double?,
    loading: Boolean,
    onRecordReading: () -> Unit,
    onViewHistory: () -> Unit,
) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type

    Column {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Icon(icon, contentDescription = null, tint = colors.textSecondary, modifier = Modifier.size(18.dp))
            Text(label, style = type.sectionHeading, color = colors.textPrimary, modifier = Modifier.padding(start = 8.dp).weight(1f))
            if (ownerCostThisMonth != null) {
                Text(
                    "This month: R ${formatCurrency(ownerCostThisMonth)}",
                    style = type.caption,
                    color = colors.textSecondary,
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        when {
            loading -> CircularProgressIndicator(modifier = Modifier.padding(8.dp).size(20.dp))
            cards.isEmpty() -> Surface(color = colors.surface, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                Text(
                    "No meter configured",
                    style = type.body,
                    color = colors.textSecondary,
                    modifier = Modifier.padding(16.dp),
                )
            }
            else -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                cards.forEach { card ->
                    MeterCardRow(card, unitOfMeasure, utilityLabel = label, onRecordReading = onRecordReading, onViewHistory = onViewHistory)
                }
            }
        }
    }
}

@Composable
private fun MeterCardRow(
    card: UtilityMeterCard,
    unitOfMeasure: String,
    utilityLabel: String,
    onRecordReading: () -> Unit,
    onViewHistory: () -> Unit,
) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val meter = card.meter
    val isTenantResponsibility = meter.responsibilityMode == "tenant_prepaid" ||
        meter.responsibilityMode == "tenant_paid_direct" ||
        meter.responsibilityMode == "included_in_rent"

    Surface(color = colors.surface, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Column {
                    Text(meter.meterNumber ?: "Meter", style = type.cardTitle.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
                    Text(responsibilityLabel(meter.responsibilityMode), style = type.caption, color = colors.textSecondary, modifier = Modifier.padding(top = 2.dp))
                }
                StatusChip(card, isTenantResponsibility, utilityLabel)
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                MetricColumn("Last reading", card.lastReadingValue?.let { "%.1f %s".format(it, unitOfMeasure) } ?: "No readings yet")
                MetricColumn("This period", card.currentPeriodUsage?.let { "%.1f %s".format(it, unitOfMeasure) } ?: "—", alignEnd = true)
            }
            if (card.previousPeriodUsage != null || card.percentChange != null) {
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    MetricColumn("Previous period", card.previousPeriodUsage?.let { "%.1f %s".format(it, unitOfMeasure) } ?: "—")
                    card.percentChange?.let {
                        MetricColumn(
                            "Change",
                            "${if (it >= 0) "+" else ""}${"%.1f".format(it)}%",
                            alignEnd = true,
                            valueColor = if (it > 0) colors.warningDeep else colors.successText,
                        )
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TextButton(onClick = onRecordReading, contentPadding = PaddingValues(0.dp)) {
                    Text("Record meter reading", style = type.captionEmphasis, color = colors.primary)
                }
                TextButton(onClick = onViewHistory, contentPadding = PaddingValues(0.dp)) {
                    Text("View history", style = type.captionEmphasis, color = colors.primary)
                }
            }
        }
    }
}

@Composable
private fun StatusChip(card: UtilityMeterCard, isTenantResponsibility: Boolean, utilityLabel: String) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val (label, color) = when {
        card.isUnusualUsage -> "Unusual ${utilityLabel.lowercase()} usage" to colors.warningDeep
        isTenantResponsibility -> "Tenant prepaid" to colors.textSecondary
        card.lastReadingValue == null -> "No readings yet" to colors.textTertiary
        else -> "Normal" to colors.successText
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (card.isUnusualUsage) {
            Icon(Icons.Outlined.WarningAmber, contentDescription = null, tint = color, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(4.dp))
        }
        Text(label, style = type.captionEmphasis, color = color)
    }
}

@Composable
private fun MetricColumn(label: String, value: String, alignEnd: Boolean = false, valueColor: Color? = null) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Column(horizontalAlignment = if (alignEnd) Alignment.End else Alignment.Start) {
        Text(label, style = type.microLabel, color = colors.textTertiary)
        Text(value, style = type.captionEmphasis.copy(fontWeight = FontWeight.Bold), color = valueColor ?: colors.textPrimary, modifier = Modifier.padding(top = 2.dp))
    }
}

private fun responsibilityLabel(mode: String): String = when (mode) {
    "owner_paid" -> "Owner pays"
    "tenant_paid_direct" -> "Tenant pays directly"
    "tenant_prepaid" -> "Tenant prepaid"
    "included_in_rent" -> "Included in rent"
    "common_area_owner" -> "Owner pays (common area)"
    else -> "Not configured"
}
