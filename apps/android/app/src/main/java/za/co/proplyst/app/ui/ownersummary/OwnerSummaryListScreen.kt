package za.co.proplyst.app.ui.ownersummary

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
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

/** Owner "Monthly property summary" (Android V1 final gap-closure pass, WORKLOG.md this date,
 * Phase 8) -- a read-only render of what the server already aggregated
 * (runOwnerMonthlySummaryJob(), lib/systemJobs.ts) via owner_property_summaries; every figure
 * here is exactly what that job stored, never recalculated on-device. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OwnerSummaryListScreen(viewModel: OwnerSummaryViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = { TopAppBar(title = { Text("Monthly summary") }) },
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
            is OwnerSummaryUiState.Loaded -> LazyColumn(modifier = Modifier.padding(padding)) {
                items(state.summaries, key = { it.id }) { summary ->
                    OwnerSummaryCard(summary)
                }
            }
        }
    }
}

@Composable
private fun OwnerSummaryCard(summary: OwnerSummary) {
    Card(modifier = Modifier.padding(16.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(summary.periodStart, style = MaterialTheme.typography.titleMedium)
            Text(
                "${summary.propertyCount} propert${if (summary.propertyCount == 1) "y" else "ies"}",
                style = MaterialTheme.typography.bodySmall,
            )
            SummaryRow("Expected rent", summary.expectedRent)
            SummaryRow("Confirmed paid", summary.confirmedPaid)
            SummaryRow("Outstanding", summary.outstanding)
            SummaryRow("Awaiting confirmation", summary.awaitingConfirmation)
            Text(
                "Open maintenance: ${summary.openMaintenanceCount} · Upcoming lease expiries: ${summary.upcomingLeaseExpiryCount}",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun SummaryRow(label: String, amount: Double) {
    Text("$label: R%.2f".format(amount), style = MaterialTheme.typography.bodyMedium)
}
