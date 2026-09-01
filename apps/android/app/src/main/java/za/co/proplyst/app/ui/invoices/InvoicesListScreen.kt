package za.co.proplyst.app.ui.invoices

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Alignment
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
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
            is InvoicesListUiState.Loaded -> LazyColumn(modifier = Modifier.padding(padding)) {
                items(state.invoices, key = { it.id }) { invoice ->
                    InvoiceRow(invoice = invoice, onClick = { onInvoiceClick(invoice.id) })
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun InvoiceRow(invoice: Invoice, onClick: () -> Unit) {
    ListItem(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        headlineContent = {
            Text(
                invoice.invoiceNumber,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        supportingContent = {
            Column {
                // Long tenant/property/unit names truncate with an ellipsis rather than wrapping
                // into a second/third line and pushing the amount/status column around --
                // NATIVE_ANDROID_SPEC.md's own component-mapping table treats list rows as a
                // fixed two-line shape.
                Text(
                    "${invoice.tenantName} · ${invoice.propertyNickname} ${invoice.unitLabel}",
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    invoice.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        },
        trailingContent = {
            Column(horizontalAlignment = Alignment.End) {
                Text("R${formatCurrency(invoice.balance)}", style = MaterialTheme.typography.titleMedium)
                StatusChip(invoice.displayStatus, modifier = Modifier.padding(top = 4.dp))
            }
        },
    )
}
