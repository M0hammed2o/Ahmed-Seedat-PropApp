package za.co.proplyst.app.ui.invoices

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Alignment
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.invoices.Invoice
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.LoadingView
import za.co.proplyst.app.ui.common.StatusChip
import za.co.proplyst.app.ui.common.formatCurrency
import androidx.compose.foundation.background
import za.co.proplyst.app.ui.common.ProplystListPadding
import za.co.proplyst.app.ui.common.ProplystListSpacing
import za.co.proplyst.app.ui.common.ProplystRecordCard
import za.co.proplyst.app.ui.theme.ProplystTheme

/** Invoice V1 completion pass (WORKLOG.md this date) -- the authoritative invoice/balance ledger,
 * a real, previously-missing V1 gap distinct from the tenant-REPORTED payment-claim workflow
 * (Payments tab). Shared composable between the Owner and Tenant nested NavHosts (each its own
 * NavController, so no route collision) -- RLS alone decides which rows come back: an owner/
 * staff caller sees their org's invoices, a tenant caller sees only their own ISSUED invoices,
 * with `paid`/`balance`/`displayStatus` always the server's own computation, never re-derived
 * on-device. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InvoicesListScreen(
    onInvoiceClick: (String) -> Unit,
    viewModel: InvoicesListViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = { TopAppBar(title = { Text("Invoices") }) },
    ) { padding ->
        when (val state = uiState) {
            is InvoicesListUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is InvoicesListUiState.Empty -> EmptyStateView(
                title = "No invoices yet",
                description = "Issued invoices will appear here.",
                modifier = Modifier.padding(padding),
            )
            is InvoicesListUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            is InvoicesListUiState.Loaded -> LazyColumn(
                modifier = Modifier.padding(padding).background(ProplystTheme.colors.background),
                contentPadding = ProplystListPadding,
                verticalArrangement = ProplystListSpacing,
            ) {
                items(state.invoices, key = { it.id }) { invoice ->
                    InvoiceRow(invoice = invoice, onClick = { onInvoiceClick(invoice.id) })
                }
            }
        }
    }
}

@Composable
private fun InvoiceRow(invoice: Invoice, onClick: () -> Unit) {
    // The amount shown is what is still owed, not the invoice total -- unlabelled, a settled invoice
    // read as an inexplicable "R0" (visual QA, 2026-09-08). "Balance" is the word this invoice's own
    // detail screen and the web invoice page both use; "Outstanding" is reserved for totals across
    // invoices.
    ProplystRecordCard(
        title = invoice.invoiceNumber,
        subtitle = "${invoice.tenantName} · ${invoice.propertyNickname} ${invoice.unitLabel}",
        meta = invoice.description,
        amount = "R${formatCurrency(invoice.balance)}",
        amountCaption = "Balance",
        onClick = onClick,
        chips = { StatusChip(invoice.displayStatus) },
    )
}
