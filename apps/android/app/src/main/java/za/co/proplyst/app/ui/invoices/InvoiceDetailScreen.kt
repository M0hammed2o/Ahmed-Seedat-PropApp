package za.co.proplyst.app.ui.invoices

import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.invoices.InvoiceDetail
import za.co.proplyst.app.data.invoices.InvoiceLineItem
import za.co.proplyst.app.data.invoices.InvoicePayment
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView
import za.co.proplyst.app.ui.common.StatusChip
import za.co.proplyst.app.ui.common.formatCurrency

/** Invoice V1 completion pass (WORKLOG.md this date). Shows the SAME `paid`/`balance`/
 * `displayStatus` truth the web app's own invoice detail/tenant `/my-payments` pages show --
 * both read through `loadInvoicesWithBalances()` server-side, never two independently-computed
 * numbers that could disagree. `onRecordPaymentClick` is only ever wired by the caller (see
 * OwnerRootScreen) when `InvoiceDetailViewModel.canRecordPayment` is true -- the server's own
 * role check on `POST /api/v1/invoices/:id/payments` remains the real enforcement regardless. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InvoiceDetailScreen(
    onBack: () -> Unit,
    onRecordPaymentClick: (() -> Unit)? = null,
    viewModel: InvoiceDetailViewModel = hiltViewModel(),
) {
    val detailState by viewModel.detailState.collectAsState()
    val paymentsState by viewModel.paymentsState.collectAsState()
    val pdfUri by viewModel.pdfUri.collectAsState()
    val pdfError by viewModel.pdfError.collectAsState()
    val openingPdf by viewModel.openingPdf.collectAsState()
    val context = LocalContext.current

    LaunchedEffect(pdfUri) {
        val uri = pdfUri ?: return@LaunchedEffect
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/pdf")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            context.startActivity(intent)
        } catch (_: android.content.ActivityNotFoundException) {
            Toast.makeText(context, "No app available to open PDF files.", Toast.LENGTH_SHORT).show()
        }
        viewModel.consumePdfUri()
    }

    LaunchedEffect(pdfError) {
        val message = pdfError ?: return@LaunchedEffect
        Toast.makeText(context, message, Toast.LENGTH_LONG).show()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Invoice") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = viewModel::openPdf, enabled = !openingPdf) {
                        if (openingPdf) {
                            CircularProgressIndicator(modifier = Modifier.padding(4.dp))
                        } else {
                            Icon(Icons.Filled.PictureAsPdf, contentDescription = "Open PDF")
                        }
                    }
                },
            )
        },
    ) { padding ->
        when (val state = detailState) {
            is InvoiceDetailUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is InvoiceDetailUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            is InvoiceDetailUiState.Loaded -> InvoiceDetailContent(
                detail = state.detail,
                paymentsState = paymentsState,
                canRecordPayment = onRecordPaymentClick != null && viewModel.canRecordPayment,
                onRecordPaymentClick = onRecordPaymentClick,
                modifier = Modifier.padding(padding),
            )
        }
    }
}

@Composable
private fun InvoiceDetailContent(
    detail: InvoiceDetail,
    paymentsState: PaymentHistoryUiState,
    canRecordPayment: Boolean,
    onRecordPaymentClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier = modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        item {
            Spacer(Modifier.height(16.dp))
            Text(detail.invoiceNumber, style = MaterialTheme.typography.headlineSmall)
            detail.description?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(4.dp))
            detail.displayStatus?.let { StatusChip(it) }
            Spacer(Modifier.height(16.dp))
        }
        item {
            AmountSummaryRow(label = "Amount", value = detail.amount)
            AmountSummaryRow(label = "Paid", value = detail.paid)
            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
            AmountSummaryRow(label = "Balance", value = detail.balance, emphasized = true)
            Spacer(Modifier.height(16.dp))
        }
        if (detail.lineItems.isNotEmpty()) {
            item {
                Text("Line items", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(4.dp))
            }
            items(detail.lineItems, key = { it.id }) { line -> LineItemRow(line) }
            item { Spacer(Modifier.height(16.dp)) }
        }
        item {
            Text("Payment history", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
        }
        when (paymentsState) {
            is PaymentHistoryUiState.Loading -> item {
                Row(modifier = Modifier.padding(vertical = 8.dp)) { CircularProgressIndicator(modifier = Modifier.height(20.dp)) }
            }
            is PaymentHistoryUiState.Error -> item {
                Text(paymentsState.message, color = MaterialTheme.colorScheme.error)
            }
            is PaymentHistoryUiState.Loaded -> {
                if (paymentsState.payments.isEmpty()) {
                    item { Text("No payments recorded yet.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                } else {
                    items(paymentsState.payments, key = { it.id }) { payment -> PaymentHistoryRow(payment) }
                }
            }
        }
        if (canRecordPayment && onRecordPaymentClick != null) {
            item {
                Spacer(Modifier.height(24.dp))
                Button(onClick = onRecordPaymentClick, modifier = Modifier.fillMaxWidth()) {
                    Text("Record payment")
                }
                Spacer(Modifier.height(16.dp))
            }
        } else {
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun AmountSummaryRow(label: String, value: Double?, emphasized: Boolean = false) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = if (emphasized) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium)
        Text(
            // null means "the server's balance-enrichment step failed, reload to try again" --
            // never rendered as R0, which would misrepresent an unknown amount as a known zero.
            if (value != null) "R${formatCurrency(value)}" else "—",
            style = if (emphasized) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
private fun LineItemRow(line: InvoiceLineItem) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(line.description, style = MaterialTheme.typography.bodyMedium)
            Text(
                "${line.quantity.toInt().takeIf { it.toDouble() == line.quantity } ?: line.quantity} × R${formatCurrency(line.unitPrice)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text("R${formatCurrency(line.amount)}", style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun PaymentHistoryRow(payment: InvoicePayment) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column {
            Text("${payment.paidAt} · ${payment.method ?: "—"}", style = MaterialTheme.typography.bodyMedium)
            payment.reference?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (payment.reversedAt != null) {
                Text(
                    "Reversed${payment.reversalReason?.let { ": $it" } ?: ""}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
        Text(
            "R${formatCurrency(payment.amount)}",
            style = MaterialTheme.typography.bodyMedium,
            color = if (payment.reversedAt != null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
        )
    }
}
