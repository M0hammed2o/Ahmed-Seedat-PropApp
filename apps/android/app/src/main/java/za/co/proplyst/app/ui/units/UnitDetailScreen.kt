package za.co.proplyst.app.ui.units

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.LoadingView
import za.co.proplyst.app.ui.common.formatArea
import za.co.proplyst.app.ui.common.formatCurrency
import za.co.proplyst.app.ui.common.ProplystScreenScaffold
import za.co.proplyst.app.ui.theme.ProplystTheme
import za.co.proplyst.app.ui.theme.ProplystPillShape
import androidx.compose.material3.ButtonDefaults
import za.co.proplyst.app.ui.common.toneForStatus
import za.co.proplyst.app.ui.common.StatusChip
import za.co.proplyst.app.ui.common.ProplystDetailRow
import za.co.proplyst.app.ui.common.ProplystDetailPadding
import za.co.proplyst.app.ui.common.ProplystDetailHeadline
import za.co.proplyst.app.ui.common.ProplystDetailCard
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UnitDetailScreen(
    onBack: () -> Unit,
    onViewLeases: () -> Unit,
    viewModel: UnitDetailViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    ProplystScreenScaffold(
        title = "Unit",
        eyebrow = "Property",
        onBack = onBack,
    ) { padding ->
        when (val state = uiState) {
            is UnitDetailUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is UnitDetailUiState.NotFound -> EmptyStateView(
                title = "Unit not found",
                modifier = Modifier.padding(padding),
            )
            is UnitDetailUiState.Loaded -> Column(
                modifier = Modifier
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(ProplystDetailPadding),
            ) {
                val status = state.unit.status.replace('_', ' ')
                ProplystDetailHeadline(
                    title = state.unit.unitLabel,
                    chips = {
                        StatusChip(
                            label = status.replaceFirstChar { it.uppercase() },
                            tone = toneForStatus(status),
                        )
                    },
                )
                ProplystDetailCard {
                    ProplystDetailRow(label = "Bedrooms", value = state.unit.bedrooms?.toString() ?: "—")
                    ProplystDetailRow(label = "Bathrooms", value = state.unit.bathrooms?.toString() ?: "—")
                    ProplystDetailRow(
                        label = "Size",
                        value = state.unit.sizeSqm?.let { "${formatArea(it)} m²" } ?: "—",
                    )
                    ProplystDetailRow(
                        label = "Market rent",
                        value = state.unit.marketRent?.let { "R${formatCurrency(it)}" } ?: "—",
                    )
                }
                Button(
                    onClick = onViewLeases,
                    shape = ProplystPillShape,
                    colors = ButtonDefaults.buttonColors(containerColor = ProplystTheme.colors.primary),
                    modifier = Modifier.padding(top = 16.dp),
                ) {
                    Text("View leases", style = ProplystTheme.type.button)
                }
            }
        }
    }
}
