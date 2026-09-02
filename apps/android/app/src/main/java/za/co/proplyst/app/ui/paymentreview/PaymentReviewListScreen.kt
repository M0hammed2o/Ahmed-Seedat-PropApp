package za.co.proplyst.app.ui.paymentreview

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.paymentreports.PaymentReport
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView

/** Owner/staff "Payment reports" review (Android V1 final gap-closure pass, WORKLOG.md this
 * date, Phase 3). Confirm/reject never touches the ledger on-device -- both call the same RPC-
 * backed endpoints (confirm_payment_report()/reject_payment_report()) the web review UI uses;
 * this screen only renders whatever RLS already scoped the caller to. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PaymentReviewListScreen(viewModel: PaymentReviewViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    val busyReportId by viewModel.busyReportId.collectAsState()
    val actionError by viewModel.actionError.collectAsState()
    val documentUrl by viewModel.documentUrl.collectAsState()
    var rejectingId by remember { mutableStateOf<String?>(null) }
    var rejectReason by remember { mutableStateOf("") }
    val context = LocalContext.current

    LaunchedEffect(documentUrl) {
        val url = documentUrl
        if (url != null) {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            viewModel.consumeDocumentUrl()
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Payment reports") }) },
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            if (actionError != null) {
                Text(
                    actionError ?: "",
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(16.dp),
                )
            }
            when (val state = uiState) {
                is PaymentReviewUiState.Loading -> LoadingView()
                is PaymentReviewUiState.Empty -> EmptyStateView(title = "No payment reports yet")
                is PaymentReviewUiState.Error -> ErrorStateView(message = state.message, onRetry = viewModel::load)
                is PaymentReviewUiState.Loaded -> LazyColumn {
                    items(state.reports, key = { it.id }) { report ->
                        PaymentReviewRow(
                            report = report,
                            busy = busyReportId == report.id,
                            rejecting = rejectingId == report.id,
                            rejectReason = rejectReason,
                            onRejectReasonChange = { rejectReason = it },
                            onConfirm = { viewModel.confirm(report.id) },
                            onStartReject = {
                                rejectingId = report.id
                                rejectReason = ""
                            },
                            onCancelReject = { rejectingId = null },
                            onConfirmReject = {
                                viewModel.reject(report.id, rejectReason)
                                rejectingId = null
                            },
                            onOpenProof = { report.documentId?.let(viewModel::openDocument) },
                        )
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}

/** §7A/§9 payment-review polish -- EFT/cash/other shown as clear labels, matching the same
 * payment_report_method enum ('eft'/'cash'/'other') this app already sends. */
private fun paymentMethodLabel(method: String): String = when (method) {
    "eft" -> "EFT / bank transfer"
    "cash" -> "Cash"
    else -> "Other"
}

@Composable
private fun PaymentReviewRow(
    report: PaymentReport,
    busy: Boolean,
    rejecting: Boolean,
    rejectReason: String,
    onRejectReasonChange: (String) -> Unit,
    onConfirm: () -> Unit,
    onStartReject: () -> Unit,
    onCancelReject: () -> Unit,
    onConfirmReject: () -> Unit,
    onOpenProof: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        ListItem(
            headlineContent = { Text("R%.2f — ${report.tenantName ?: "Unknown tenant"}".format(report.amount)) },
            supportingContent = {
                Column {
                    Text("${report.propertyName ?: "Unknown property"} · ${paymentMethodLabel(report.paymentMethod)} · ${report.paymentDate}")
                    Text(
                        if (report.paymentMethod == "cash" && !report.reportedByTenant)
                            "Cash collected by staff on the tenant's behalf"
                        else if (report.reportedByTenant)
                            "Reported by tenant"
                        else
                            "Recorded by staff",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    if (report.status == "rejected" && report.rejectionReason != null) {
                        Text(
                            "Rejected: ${report.rejectionReason}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    } else if (report.status == "confirmed") {
                        Text(
                            "Confirmed",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            },
        )
        Row(modifier = Modifier.padding(start = 16.dp, bottom = 8.dp)) {
            if (report.documentId != null) {
                TextButton(onClick = onOpenProof) { Text("View proof") }
            }
            if (report.status == "reported") {
                Button(onClick = onConfirm, enabled = !busy) { Text("Confirm payment received") }
                TextButton(onClick = onStartReject, enabled = !busy) { Text("Reject") }
            }
        }
        if (rejecting) {
            Row(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                OutlinedTextField(
                    value = rejectReason,
                    onValueChange = onRejectReasonChange,
                    label = { Text("Reason for rejecting") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Row(modifier = Modifier.padding(start = 16.dp, bottom = 8.dp)) {
                Button(onClick = onConfirmReject) { Text("Confirm rejection") }
                TextButton(onClick = onCancelReject) { Text("Cancel") }
            }
        }
    }
}
