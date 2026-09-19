package za.co.proplyst.app.ui.ownersummary

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.ownersummary.OwnerSummary
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import za.co.proplyst.app.ui.common.ProplystListPadding
import za.co.proplyst.app.ui.common.ProplystListSpacing
import za.co.proplyst.app.ui.common.StatusChip
import za.co.proplyst.app.ui.common.StatusTone
import za.co.proplyst.app.ui.theme.ProplystTheme
import za.co.proplyst.app.ui.common.ProplystScreenScaffold
import za.co.proplyst.app.ui.common.formatCurrency

/** Owner "Monthly property summary" (Android V1 final gap-closure pass, WORKLOG.md this date,
 * Phase 8) -- a read-only render of what the server already aggregated
 * (runOwnerMonthlySummaryJob(), lib/systemJobs.ts) via owner_property_summaries; every figure
 * here is exactly what that job stored, never recalculated on-device. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OwnerSummaryListScreen(viewModel: OwnerSummaryViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()

    ProplystScreenScaffold(
        title = "Monthly summary",
        eyebrow = "Reports",
    ) { padding ->
        when (val state = uiState) {
            is OwnerSummaryUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is OwnerSummaryUiState.Empty -> EmptyStateView(
                title = "No monthly summary yet",
                description = "Your first summary appears once it's generated.",
                modifier = Modifier.padding(padding),
            )
            is OwnerSummaryUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            is OwnerSummaryUiState.Loaded -> LazyColumn(
                modifier = Modifier.padding(padding).background(ProplystTheme.colors.background),
                contentPadding = ProplystListPadding,
                verticalArrangement = ProplystListSpacing,
            ) {
                items(state.summaries, key = { it.id }) { summary ->
                    OwnerSummaryCard(summary)
                }
            }
        }
    }
}

@Composable
private fun OwnerSummaryCard(summary: OwnerSummary) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Surface(color = colors.surface, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(summary.periodStart, style = type.cardTitle, color = colors.textPrimary)
            Text(
                "${summary.propertyCount} propert${if (summary.propertyCount == 1) "y" else "ies"}",
                style = type.meta,
                color = colors.textTertiary,
                modifier = Modifier.padding(top = 2.dp, bottom = 10.dp),
            )
            SummaryRow("Expected rent", summary.expectedRent)
            SummaryRow("Confirmed paid", summary.confirmedPaid, valueColor = colors.successText)
            SummaryRow("Outstanding", summary.outstanding, valueColor = colors.criticalDeep)
            SummaryRow("Awaiting confirmation", summary.awaitingConfirmation)
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(top = 10.dp),
            ) {
                StatusChip(
                    label = "${summary.openMaintenanceCount} open maintenance",
                    tone = if (summary.openMaintenanceCount > 0) StatusTone.WARNING else StatusTone.NEUTRAL,
                )
                StatusChip(
                    label = "${summary.upcomingLeaseExpiryCount} lease renewals",
                    tone = if (summary.upcomingLeaseExpiryCount > 0) StatusTone.INFO else StatusTone.NEUTRAL,
                )
            }
        }
    }
}

@Composable
private fun SummaryRow(label: String, amount: Double, valueColor: Color? = null) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Row(
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
    ) {
        Text(label, style = type.body, color = colors.textSecondary)
        Text("R${formatCurrency(amount)}", style = type.body, color = valueColor ?: colors.textPrimary, maxLines = 1)
    }
}
