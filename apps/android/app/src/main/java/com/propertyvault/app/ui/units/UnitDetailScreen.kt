package com.propertyvault.app.ui.units

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
fun UnitDetailScreen(
    onBack: () -> Unit,
    viewModel: UnitDetailViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Unit") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        when (val state = uiState) {
            is UnitDetailUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is UnitDetailUiState.NotFound -> EmptyStateView(
                title = "Unit not found",
                modifier = Modifier.padding(padding),
            )
            is UnitDetailUiState.Loaded -> Column(modifier = Modifier.padding(padding).padding(16.dp)) {
                Text(state.unit.unitLabel, style = MaterialTheme.typography.headlineMedium)
                DetailRow(label = "Status", value = state.unit.status.replace('_', ' '))
                DetailRow(label = "Bedrooms", value = state.unit.bedrooms?.toString() ?: "—")
                DetailRow(label = "Bathrooms", value = state.unit.bathrooms?.toString() ?: "—")
                DetailRow(label = "Size", value = state.unit.sizeSqm?.let { "${formatArea(it)} m²" } ?: "—")
                DetailRow(label = "Market rent", value = state.unit.marketRent?.let { "R${formatCurrency(it)}" } ?: "—")
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

// Real bug caught on-device (2026-08-01): a raw Double rendered as "R10650.0"/"65.0 m²" -- Kotlin's
// default Double.toString() always keeps at least one decimal place, even for whole numbers.
private fun formatCurrency(value: Double): String =
    if (value % 1.0 == 0.0) "%,d".format(value.toLong()) else "%,.2f".format(value)

private fun formatArea(value: Double): String =
    if (value % 1.0 == 0.0) value.toLong().toString() else "%.1f".format(value)
