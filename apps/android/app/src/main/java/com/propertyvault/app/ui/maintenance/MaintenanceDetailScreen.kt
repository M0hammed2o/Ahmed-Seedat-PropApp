package com.propertyvault.app.ui.maintenance

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.propertyvault.app.ui.common.EmptyStateView
import com.propertyvault.app.ui.common.LoadingView

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MaintenanceDetailScreen(
    onBack: () -> Unit,
    viewModel: MaintenanceDetailViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Ticket") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        when (val state = uiState) {
            is MaintenanceDetailUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is MaintenanceDetailUiState.NotFound -> EmptyStateView(
                title = "Ticket not found",
                modifier = Modifier.padding(padding),
            )
            is MaintenanceDetailUiState.Loaded -> Column(modifier = Modifier.padding(padding).padding(16.dp)) {
                Text(state.ticket.summary, style = MaterialTheme.typography.headlineMedium)
                DetailRow(label = "Priority", value = state.ticket.priority.replace('_', ' '))
                DetailRow(label = "Status", value = state.ticket.status.replace('_', ' '))
                if (!state.ticket.description.isNullOrBlank()) {
                    DetailRow(label = "Description", value = state.ticket.description)
                }
            }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyLarge)
    }
}
