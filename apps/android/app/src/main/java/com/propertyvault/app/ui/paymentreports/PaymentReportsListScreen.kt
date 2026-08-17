package com.propertyvault.app.ui.paymentreports

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import com.propertyvault.app.data.paymentreports.PaymentReport
import com.propertyvault.app.ui.common.EmptyStateView
import com.propertyvault.app.ui.common.ErrorStateView
import com.propertyvault.app.ui.common.LoadingView

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
            is PaymentReportsListUiState.Loaded -> LazyColumn(modifier = Modifier.padding(padding)) {
                items(state.reports, key = { it.id }) { report ->
                    PaymentReportRow(report)
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun PaymentReportRow(report: PaymentReport) {
    ListItem(
        headlineContent = { Text("R%.2f".format(report.amount)) },
        supportingContent = {
            Column {
                Text("${report.paymentMethod.replaceFirstChar { it.uppercase() }} — ${report.paymentDate}")
                if (report.status == "rejected" && report.rejectionReason != null) {
                    Text(
                        report.rejectionReason,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        trailingContent = { StatusLabel(report.status) },
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun StatusLabel(status: String) {
    val (label, color) = when (status) {
        "confirmed" -> "Confirmed" to MaterialTheme.colorScheme.primary
        "rejected" -> "Rejected" to MaterialTheme.colorScheme.error
        else -> "Awaiting confirmation" to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Text(label, style = MaterialTheme.typography.labelMedium, color = color)
}
