package com.propertyvault.app.ui.maintenance

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import com.propertyvault.app.ui.common.CachedDataBanner
import com.propertyvault.app.ui.common.EmptyStateView
import com.propertyvault.app.ui.common.ErrorStateView
import com.propertyvault.app.ui.common.LoadingView

/** View-only for now -- ticket submission needs the admin API's Bearer-JWT auth path, which isn't
 * wired up server-side yet (see MaintenanceTicket.kt's doc comment). Org-wide list, matching
 * apps/admin's own /maintenance board. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MaintenanceListScreen(
    onTicketClick: (String) -> Unit,
    viewModel: MaintenanceListViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = { TopAppBar(title = { Text("Maintenance") }) },
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
