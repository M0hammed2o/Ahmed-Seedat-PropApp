package za.co.proplyst.app.ui.maintenance

import androidx.compose.foundation.clickable
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
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.ui.common.CachedDataBanner
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView

/** RLS (`maintenance_tickets_select_tenant_self`/`_select_staff_or_owner`) scopes this list to
 * whatever the caller is allowed to see -- org-wide for staff/owner, own tickets only for a
 * tenant caller -- shared between both portals, same pattern as PaymentReportsListScreen. The
 * optional FAB (onCreateClick) is tenant-only: owners don't submit tickets against themselves in
 * this pass, so OwnerRootScreen simply omits it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MaintenanceListScreen(
    onTicketClick: (String) -> Unit,
    onCreateClick: (() -> Unit)? = null,
    viewModel: MaintenanceListViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = { TopAppBar(title = { Text("Maintenance") }) },
        floatingActionButton = {
            if (onCreateClick != null) {
                FloatingActionButton(onClick = onCreateClick) {
                    Icon(Icons.Filled.Add, contentDescription = "Report an issue")
                }
            }
        },
    ) { padding ->
        when (val state = uiState) {
            is MaintenanceListUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is MaintenanceListUiState.Empty -> EmptyStateView(
                title = state.message,
                modifier = Modifier.padding(padding),
            )
            is MaintenanceListUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            is MaintenanceListUiState.Loaded -> Column(modifier = Modifier.padding(padding)) {
                if (state.cachedAt != null) {
                    CachedDataBanner(relativeTime = state.cachedAt)
                }
                LazyColumn {
                    items(state.tickets, key = { it.id }) { ticket ->
                        ListItem(
                            headlineContent = { Text(ticket.summary) },
                            supportingContent = {
                                Text("${ticket.priority.replace('_', ' ')} — ${ticket.status.replace('_', ' ')}")
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onTicketClick(ticket.id) },
                        )
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}
