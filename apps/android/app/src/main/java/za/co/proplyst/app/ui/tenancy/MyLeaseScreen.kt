package za.co.proplyst.app.ui.tenancy

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.tenancy.TenancyLease
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView
import za.co.proplyst.app.ui.common.StatusChip
import za.co.proplyst.app.ui.common.formatCurrency

/** "My Lease" (Invoice V1 completion pass, WORKLOG.md this date) -- answers "what property/unit
 * am I renting, what is my lease status" for the tenant portal, a real, previously-missing V1
 * gap. Multiple-tenancy note: see TenancyRepository's own doc comment -- this shows the caller's
 * most likely-current tenancy (active, else most recent), not a switcher; a real switcher would
 * need new backend API-layer scoping this pass's "use the current backend contract" instruction
 * doesn't cover. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MyLeaseScreen(
    onBack: () -> Unit,
    viewModel: MyLeaseViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("My Lease") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        when (val state = uiState) {
            is MyLeaseUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is MyLeaseUiState.NoTenancy -> EmptyStateView(
                title = "No lease on file",
                description = "We couldn't find an active tenancy for your account.",
                modifier = Modifier.padding(padding),
            )
            is MyLeaseUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            is MyLeaseUiState.Loaded -> MyLeaseContent(state.lease, modifier = Modifier.padding(padding))
        }
    }
}

@Composable
private fun MyLeaseContent(lease: TenancyLease, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth().padding(16.dp)) {
        Text(lease.propertyNickname ?: "Your property", style = MaterialTheme.typography.headlineSmall)
        lease.propertyAddress?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        lease.unitLabel?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        lease.leaseStatus?.let {
            StatusChip(
                // Capitalized to match InvoiceDisplayStatus's own Title Case convention
                // (StatusChip's colour map keys on that shape) -- the raw lease.status is
                // lowercase ("active"/"expired"/"terminated") straight off the leases table.
                it.replaceFirstChar { c -> c.uppercase() },
                modifier = Modifier.padding(top = 8.dp),
            )
        }

        HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))

        DetailRow("Start date", lease.startDate ?: "—")
        DetailRow("End date", lease.endDate ?: "Month-to-month (no fixed end date)")
        lease.rentAmount?.let { DetailRow("Rent", "R${formatCurrency(it)}") }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}
