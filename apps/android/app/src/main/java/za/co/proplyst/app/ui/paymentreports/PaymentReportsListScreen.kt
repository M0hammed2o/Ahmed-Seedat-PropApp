package za.co.proplyst.app.ui.paymentreports

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.paymentreports.PaymentReport
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView
import androidx.compose.foundation.background
import androidx.compose.ui.text.style.TextOverflow
import za.co.proplyst.app.ui.common.ProplystListPadding
import za.co.proplyst.app.ui.common.ProplystListSpacing
import za.co.proplyst.app.ui.common.ProplystRecordCard
import za.co.proplyst.app.ui.common.StatusChip
import za.co.proplyst.app.ui.common.toneForStatus
import za.co.proplyst.app.ui.theme.ProplystTheme

/** Tenant portal "My Payments" (Android V1 commercial-launch pass, WORKLOG.md this date, Phase
 * 4) -- mirrors the web app's /my-payments payment-report history + report-a-payment entry point.
 * Deliberately does not attempt the full rent-schedule/outstanding-balance dashboard the web page
 * also shows -- that needs its own RLS-scoped PostgREST read and is a separate, disclosed gap. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PaymentReportsListScreen(
    onReportPaymentClick: () -> Unit,
    viewModel: PaymentReportsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = { TopAppBar(title = { Text("My Payments") }) },
        floatingActionButton = {
            FloatingActionButton(onClick = onReportPaymentClick) {
                Icon(Icons.Filled.Add, contentDescription = "Report a payment")
            }
        },
    ) { padding ->
        when (val state = uiState) {
            is PaymentReportsListUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is PaymentReportsListUiState.Empty -> EmptyStateView(
                title = "No payments reported yet",
                description = "Tap + to report a payment you've made.",
                modifier = Modifier.padding(padding),
            )
            is PaymentReportsListUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            is PaymentReportsListUiState.Loaded -> LazyColumn(
                modifier = Modifier.padding(padding).background(ProplystTheme.colors.background),
                contentPadding = ProplystListPadding,
                verticalArrangement = ProplystListSpacing,
            ) {
                items(state.reports, key = { it.id }) { report ->
                    PaymentReportRow(report)
                }
            }
        }
    }
}

@Composable
private fun PaymentReportRow(report: PaymentReport) {
    val colors = ProplystTheme.colors
    val statusLabel = when (report.status) {
        "confirmed" -> "Confirmed"
        "rejected" -> "Rejected"
        else -> "Awaiting confirmation"
    }
    ProplystRecordCard(
        title = "R%.2f".format(report.amount),
        subtitle = listOfNotNull(report.tenantName, report.propertyName)
            .takeIf { it.isNotEmpty() }
            ?.joinToString(" · "),
        meta = "${report.paymentMethod.replaceFirstChar { it.uppercase() }} · ${report.paymentDate}",
        accent = when (report.status) {
            "confirmed" -> colors.success
            "rejected" -> colors.critical
            else -> colors.warning
        },
        chips = {
            StatusChip(label = statusLabel, tone = toneForStatus(report.status))
            // A rejection is only meaningful with its reason, so it stays on the card.
            if (report.status == "rejected" && report.rejectionReason != null) {
                Text(
                    report.rejectionReason,
                    style = ProplystTheme.type.meta,
                    color = colors.criticalDeep,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        },
    )
}
