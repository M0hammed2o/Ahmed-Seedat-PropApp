package com.propertyvault.app.ui.properties

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
fun PropertyDetailScreen(
    onBack: () -> Unit,
    viewModel: PropertyDetailViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Property") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        when (val state = uiState) {
            is PropertyDetailUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is PropertyDetailUiState.NotFound -> EmptyStateView(
                title = "Property not found",
                modifier = Modifier.padding(padding),
            )
            is PropertyDetailUiState.Loaded -> Column(modifier = Modifier.padding(padding).padding(16.dp)) {
                Text(state.property.nickname, style = MaterialTheme.typography.headlineMedium)
                Text(
                    state.property.fullAddress,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(top = 4.dp, bottom = 16.dp),
                )
                DetailRow(label = "Type", value = state.property.propertyType.replace('_', ' '))
                DetailRow(label = "City", value = state.property.city)
                DetailRow(label = "Province", value = state.property.province ?: "—")
                DetailRow(label = "Status", value = state.property.status)
                if (!state.property.notes.isNullOrBlank()) {
                    Text(
                        "Notes",
                        style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier.padding(top = 16.dp, bottom = 4.dp),
                    )
                    Text(state.property.notes, style = MaterialTheme.typography.bodyMedium)
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
