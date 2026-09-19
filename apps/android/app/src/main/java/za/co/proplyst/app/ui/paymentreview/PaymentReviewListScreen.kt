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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import za.co.proplyst.app.ui.common.ProplystListPadding
import za.co.proplyst.app.ui.common.ProplystListSpacing
import za.co.proplyst.app.ui.common.StatusChip
import za.co.proplyst.app.ui.common.toneForStatus
import za.co.proplyst.app.ui.theme.ProplystPillShape
import za.co.proplyst.app.ui.theme.ProplystTheme
import za.co.proplyst.app.ui.common.ProplystScreenScaffold
import za.co.proplyst.app.ui.common.relativeTimeLabel
import za.co.proplyst.app.ui.common.formatCurrency

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

    ProplystScreenScaffold(
        title = "Payment reports",
        eyebrow = "Finance",
    ) { padding ->
        Column(modifier = Modifier.padding(padding).background(ProplystTheme.colors.background)) {
            if (actionError != null) {
                Surface(
                    color = ProplystTheme.colors.criticalBg,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    Text(
                        actionError ?: "",
                        style = ProplystTheme.type.body,
                        color = ProplystTheme.colors.criticalDeep,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }
            when (val state = uiState) {
                is PaymentReviewUiState.Loading -> LoadingView()
                is PaymentReviewUiState.Empty -> EmptyStateView(title = "No payment reports yet")
                is PaymentReviewUiState.Error -> ErrorStateView(message = state.message, onRetry = viewModel::load)
                is PaymentReviewUiState.Loaded -> LazyColumn(
                    contentPadding = ProplystListPadding,
                    verticalArrangement = ProplystListSpacing,
                ) {
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
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val origin = when {
        report.paymentMethod == "cash" && !report.reportedByTenant -> "Cash collected by staff on the tenant's behalf"
        report.reportedByTenant -> "Reported by tenant"
        else -> "Recorded by staff"
    }

    Surface(color = colors.surface, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "R${formatCurrency(report.amount)}",
                        style = type.settingsTitle,
                        color = colors.textPrimary,
                        maxLines = 1,
                    )
                    Text(
                        report.tenantName ?: "Unknown tenant",
                        style = type.body,
                        color = colors.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                StatusChip(
                    label = when (report.status) {
                        "confirmed" -> "Confirmed"
                        "rejected" -> "Rejected"
                        else -> "Awaiting confirmation"
                    },
                    tone = toneForStatus(report.status),
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                "${report.propertyName ?: "Unknown property"} · ${paymentMethodLabel(report.paymentMethod)} · ${report.paymentDate}",
                style = type.meta,
                color = colors.textSecondary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                "$origin · reported ${relativeTimeLabel(report.createdAt)}",
                style = type.meta,
                color = colors.textTertiary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (report.status == "rejected" && report.rejectionReason != null) {
                Spacer(modifier = Modifier.height(6.dp))
                Text("Rejected: ${report.rejectionReason}", style = type.meta, color = colors.criticalDeep)
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(top = 12.dp),
            ) {
                if (report.documentId != null) {
                    TextButton(onClick = onOpenProof, contentPadding = PaddingValues(horizontal = 8.dp)) {
                        Text("View proof", style = type.buttonSecondary, color = colors.primary)
                    }
                }
                if (report.status == "reported") {
                    // Disabled while the call is in flight, so a double tap cannot fire it twice.
                    // The server is idempotent too (confirm_payment_report returns success without
                    // re-allocating), so neither half depends on the other being perfect.
                    Button(
                        onClick = onConfirm,
                        enabled = !busy,
                        shape = ProplystPillShape,
                        colors = ButtonDefaults.buttonColors(containerColor = colors.primary),
                        modifier = Modifier.weight(1f),
                    ) {
                        if (busy) {
                            CircularProgressIndicator(
                                strokeWidth = 2.dp,
                                color = Color.White,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                        }
                        Text(if (busy) "Confirming…" else "Confirm payment received", style = type.button, maxLines = 1)
                    }
                    TextButton(onClick = onStartReject, enabled = !busy, contentPadding = PaddingValues(horizontal = 8.dp)) {
                        Text("Reject", style = type.buttonSecondary, color = colors.textSecondary)
                    }
                }
            }

            if (rejecting) {
                OutlinedTextField(
                    value = rejectReason,
                    onValueChange = onRejectReasonChange,
                    label = { Text("Reason for rejecting", style = type.meta) },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                    Button(
                        onClick = onConfirmReject,
                        shape = ProplystPillShape,
                        colors = ButtonDefaults.buttonColors(containerColor = colors.critical),
                    ) {
                        Text("Confirm rejection", style = type.button)
                    }
                    TextButton(onClick = onCancelReject) {
                        Text("Cancel", style = type.buttonSecondary, color = colors.textSecondary)
                    }
                }
            }
        }
    }
}
