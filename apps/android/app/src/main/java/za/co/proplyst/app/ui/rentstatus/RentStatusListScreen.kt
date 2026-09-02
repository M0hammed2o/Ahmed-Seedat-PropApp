package za.co.proplyst.app.ui.rentstatus

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.financials.TenantPaymentStatusRow
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView
import za.co.proplyst.app.ui.common.navyHeaderGlow
import za.co.proplyst.app.ui.theme.ProplystTheme

/** Owner "Rent status" -- paid/unpaid tenant list (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §6, §9-A).
 * Server-authoritative: every row's status is rent_schedules.status as returned by
 * /api/v1/properties/:id/tenant-payment-status, never inferred from payment-report claims. */
@Composable
fun RentStatusListScreen(
    onBack: () -> Unit,
    viewModel: RentStatusViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val properties by viewModel.properties.collectAsState()
    val selectedPropertyId by viewModel.selectedPropertyId.collectAsState()
    val filter by viewModel.filter.collectAsState()
    val month by viewModel.month.collectAsState()

    val colors = ProplystTheme.colors
    val type = ProplystTheme.type

    Column(modifier = Modifier.fillMaxSize().background(colors.background)) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.navy)
                .navyHeaderGlow()
                .statusBarsPadding()
                .padding(top = 10.dp, bottom = 20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 20.dp)) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back", tint = Color.White)
                }
                Column {
                    Text("Settings", style = type.meta, color = colors.navySecondaryOn)
                    Text("Rent status", style = type.settingsTitle, color = Color.White)
                }
            }

            if (properties.size > 1) {
                Row(
                    modifier = Modifier
                        .padding(top = 14.dp, start = 20.dp)
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    properties.forEach { property ->
                        val selected = property.id == selectedPropertyId
                        Surface(
                            shape = RoundedCornerShape(999.dp),
                            color = if (selected) colors.primary else Color.White.copy(alpha = 0.08f),
                            modifier = Modifier.clickable { viewModel.selectProperty(property.id) },
                        ) {
                            Text(
                                property.nickname,
                                style = type.chipLabel,
                                color = Color.White,
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                            )
                        }
                    }
                }
            }

            Row(
                modifier = Modifier
                    .padding(top = 14.dp, start = 20.dp)
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                RentStatusFilter.entries.forEach { f ->
                    val selected = f == filter
                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = if (selected) Color.White else Color.White.copy(alpha = 0.08f),
                        modifier = Modifier.clickable { viewModel.setFilter(f) },
                    ) {
                        Text(
                            f.label,
                            style = type.chipLabel,
                            color = if (selected) colors.navy else Color.White,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        )
                    }
                }
            }
        }

        when (val state = uiState) {
            is RentStatusUiState.Loading -> LoadingView(modifier = Modifier.fillMaxSize())
            is RentStatusUiState.NoProperties -> EmptyStateView(
                title = "No properties yet",
                description = "Rent status appears once you have at least one property.",
                modifier = Modifier.fillMaxSize(),
            )
            is RentStatusUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::loadRentStatus,
                modifier = Modifier.fillMaxSize(),
            )
            is RentStatusUiState.Loaded -> {
                val filtered = state.rows.filter { row ->
                    when (filter) {
                        RentStatusFilter.ALL -> true
                        RentStatusFilter.PAID -> row.status == "paid"
                        RentStatusFilter.PARTIAL -> row.status == "partial"
                        RentStatusFilter.UNPAID -> row.status == "pending" || row.status == "invoiced"
                        RentStatusFilter.OVERDUE -> row.status == "overdue"
                    }
                }
                if (filtered.isEmpty()) {
                    EmptyStateView(
                        title = "No tenants match this filter",
                        modifier = Modifier.fillMaxSize(),
                    )
                } else {
                    LazyColumn(
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(
                            horizontal = 20.dp,
                            vertical = 16.dp,
                        ),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(filtered, key = { it.rentScheduleId }) { row ->
                            RentStatusCard(row)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RentStatusCard(row: TenantPaymentStatusRow) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val (statusLabel, statusColor, statusBg) = statusVisuals(row.status)

    Surface(
        color = colors.surface,
        shape = RoundedCornerShape(16.dp),
        shadowElevation = 1.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Column {
                    Text(row.tenantName, style = type.cardTitle.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
                    Text(row.unitLabel, style = type.caption, color = colors.textSecondary)
                }
                Surface(color = statusBg, shape = RoundedCornerShape(999.dp)) {
                    Text(
                        statusLabel,
                        style = type.chipLabel,
                        color = statusColor,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                AmountColumn("Expected", row.expectedRent, colors.textPrimary)
                AmountColumn("Paid", row.confirmedPaid, colors.successText)
                AmountColumn(
                    "Outstanding",
                    row.outstanding,
                    if (row.outstanding > 0) colors.criticalDeep else colors.textSecondary,
                )
            }
        }
    }
}

@Composable
private fun AmountColumn(label: String, amount: Double, color: Color) {
    val type = ProplystTheme.type
    Column {
        Text(label, style = type.meta, color = ProplystTheme.colors.textSecondary)
        Text("R %.2f".format(amount), style = type.captionEmphasis.copy(fontWeight = FontWeight.Bold), color = color)
    }
}

@Composable
private fun statusVisuals(status: String): Triple<String, Color, Color> {
    val colors = ProplystTheme.colors
    return when (status) {
        "paid" -> Triple("Paid", colors.successText, colors.successBg)
        "partial" -> Triple("Partial", colors.warningDeep, colors.warningBg)
        "overdue" -> Triple("Overdue", colors.criticalDeep, colors.criticalBg)
        else -> Triple("Pending", colors.textSecondary, colors.inputSurface)
    }
}
