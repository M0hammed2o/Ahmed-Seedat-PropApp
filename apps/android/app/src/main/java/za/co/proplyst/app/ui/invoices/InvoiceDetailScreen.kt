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
import androidx.compose.material3.Text
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
import za.co.proplyst.app.ui.common.ProplystScreenScaffold
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView
import za.co.proplyst.app.ui.common.StatusChip
import za.co.proplyst.app.ui.common.formatCurrency
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.size
import za.co.proplyst.app.ui.theme.ProplystTheme
import za.co.proplyst.app.ui.theme.ProplystPillShape
import za.co.proplyst.app.ui.common.ProplystSectionLabel
import za.co.proplyst.app.ui.common.ProplystListSpacing
import za.co.proplyst.app.ui.common.ProplystDetailPadding
import za.co.proplyst.app.ui.common.ProplystDetailHeadline
import za.co.proplyst.app.ui.common.ProplystDetailCard
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.material3.ButtonDefaults
import androidx.compose.foundation.background

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

    ProplystScreenScaffold(
        title = "Invoice",
        eyebrow = "Billing",
        onBack = onBack,
        actions = {
            IconButton(onClick = viewModel::openPdf, enabled = !openingPdf) {
                if (openingPdf) {
                    CircularProgressIndicator(
                        color = Color.White,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(20.dp),
                    )
                } else {
                    Icon(Icons.Filled.PictureAsPdf, contentDescription = "Open PDF", tint = Color.White)
                }
            }
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
    LazyColumn(
        modifier = modifier.fillMaxSize().background(ProplystTheme.colors.background),
        contentPadding = ProplystDetailPadding,
        verticalArrangement = ProplystListSpacing,
    ) {
        item {
            ProplystDetailHeadline(
                title = detail.invoiceNumber,
                subtitle = detail.description,
                chips = { detail.displayStatus?.let { StatusChip(it) } },
            )
        }
        item {
            ProplystDetailCard {
                AmountSummaryRow(label = "Amount", value = detail.amount)
                AmountSummaryRow(label = "Paid", value = detail.paid)
                HorizontalDivider(color = ProplystTheme.colors.divider)
                AmountSummaryRow(label = "Balance", value = detail.balance, emphasized = true)
            }
        }
        if (detail.lineItems.isNotEmpty()) {
            item { ProplystSectionLabel("Line items") }
            item {
                ProplystDetailCard {
                    detail.lineItems.forEachIndexed { index, line ->
                        if (index > 0) HorizontalDivider(color = ProplystTheme.colors.divider)
                        LineItemRow(line)
                    }
                }
            }
        }
        item { ProplystSectionLabel("Payment history") }
        when (paymentsState) {
            is PaymentHistoryUiState.Loading -> item {
                ProplystDetailCard {
                    Row(modifier = Modifier.padding(vertical = 10.dp)) {
                        CircularProgressIndicator(
                            color = ProplystTheme.colors.primary,
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
            }
            is PaymentHistoryUiState.Error -> item {
                ProplystDetailCard {
                    Text(
                        paymentsState.message,
                        style = ProplystTheme.type.body,
                        color = ProplystTheme.colors.criticalDeep,
                        modifier = Modifier.padding(vertical = 10.dp),
                    )
                }
            }
            is PaymentHistoryUiState.Loaded -> item {
                ProplystDetailCard {
                    if (paymentsState.payments.isEmpty()) {
                        Text(
                            "No payments recorded yet.",
                            style = ProplystTheme.type.body,
                            color = ProplystTheme.colors.textSecondary,
                            modifier = Modifier.padding(vertical = 10.dp),
                        )
                    } else {
                        paymentsState.payments.forEachIndexed { index, payment ->
                            if (index > 0) HorizontalDivider(color = ProplystTheme.colors.divider)
                            PaymentHistoryRow(payment)
                        }
                    }
                }
            }
        }
        if (canRecordPayment && onRecordPaymentClick != null) {
            item {
                Spacer(Modifier.height(8.dp))
                // A settled invoice still ACCEPTS a payment -- corrections and genuine overpayments
                // are real accounting events and the server remains the authority on both, so
                // nothing about the calculation or the permission changes here. What changes is
                // that it stops *asking* for one: on a zero balance the call to action drops to an
                // outlined button and says what it would actually be, instead of presenting a
                // filled "Record payment" that reads as an outstanding task (visual QA, 2026-09-08).
                val settled = (detail.balance ?: 0.0) <= 0.0
                if (settled) {
                    Text(
                        "This invoice is fully paid.",
                        style = ProplystTheme.type.body,
                        color = ProplystTheme.colors.textSecondary,
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = onRecordPaymentClick,
                        shape = ProplystPillShape,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            "Record another payment",
                            style = ProplystTheme.type.buttonSecondary,
                            color = ProplystTheme.colors.primary,
                        )
                    }
                } else {
                    Button(
                        onClick = onRecordPaymentClick,
                        shape = ProplystPillShape,
                        colors = ButtonDefaults.buttonColors(containerColor = ProplystTheme.colors.primary),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Record payment", style = ProplystTheme.type.button)
                    }
                }
            }
        }
    }
}

@Composable
private fun AmountSummaryRow(label: String, value: Double?, emphasized: Boolean = false) {
    val type = ProplystTheme.type
    val colors = ProplystTheme.colors
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = if (emphasized) type.cardTitle else type.body,
            color = if (emphasized) colors.textPrimary else colors.textSecondary,
        )
        Text(
            // null means "the server's balance-enrichment step failed, reload to try again" --
            // never rendered as R0, which would misrepresent an unknown amount as a known zero.
            if (value != null) "R${formatCurrency(value)}" else "—",
            style = if (emphasized) type.cardTitle else type.body,
            color = colors.textPrimary,
            maxLines = 1,
        )
    }
}

@Composable
private fun LineItemRow(line: InvoiceLineItem) {
    val type = ProplystTheme.type
    val colors = ProplystTheme.colors
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                line.description,
                style = type.body,
                color = colors.textPrimary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                "${line.quantity.toInt().takeIf { it.toDouble() == line.quantity } ?: line.quantity} × R${formatCurrency(line.unitPrice)}",
                style = type.meta,
                color = colors.textTertiary,
            )
        }
        Text(
            "R${formatCurrency(line.amount)}",
            style = type.body,
            color = colors.textPrimary,
            maxLines = 1,
            modifier = Modifier.padding(start = 12.dp),
        )
    }
}

@Composable
private fun PaymentHistoryRow(payment: InvoicePayment) {
    val type = ProplystTheme.type
    val colors = ProplystTheme.colors
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                "${payment.paidAt} · ${payment.method ?: "—"}",
                style = type.body,
                color = colors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            payment.reference?.let {
                Text(it, style = type.meta, color = colors.textTertiary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (payment.reversedAt != null) {
                Text(
                    "Reversed${payment.reversalReason?.let { ": $it" } ?: ""}",
                    style = type.meta,
                    color = colors.criticalDeep,
                    maxLines = 2,
                )
            }
        }
        Text(
            "R${formatCurrency(payment.amount)}",
            style = type.body,
            color = if (payment.reversedAt != null) colors.textTertiary else colors.textPrimary,
            maxLines = 1,
            modifier = Modifier.padding(start = 12.dp),
        )
    }
}
