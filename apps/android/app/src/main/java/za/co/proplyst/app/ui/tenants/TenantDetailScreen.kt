package za.co.proplyst.app.ui.tenants

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
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
import za.co.proplyst.app.ui.common.ProplystScreenScaffold
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
fun TenantDetailScreen(
    onBack: () -> Unit,
    viewModel: TenantDetailViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    ProplystScreenScaffold(
        title = "Tenant",
        eyebrow = "Portfolio",
        onBack = onBack,
    ) { padding ->
        when (val state = uiState) {
            is TenantDetailUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is TenantDetailUiState.NotFound -> EmptyStateView(
                title = "Tenant not found",
                modifier = Modifier.padding(padding),
            )
            is TenantDetailUiState.Loaded -> Column(
                modifier = Modifier
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(ProplystDetailPadding),
            ) {
                val status = state.tenant.status.replace('_', ' ')
                ProplystDetailHeadline(
                    title = state.tenant.fullName,
                    chips = {
                        StatusChip(
                            label = status.replaceFirstChar { it.uppercase() },
                            tone = toneForStatus(status),
                        )
                    },
                )
                ProplystDetailCard {
                    ProplystDetailRow(label = "Email", value = state.tenant.email ?: "—")
                    ProplystDetailRow(label = "Phone", value = state.tenant.phone ?: "—")
                }
            }
        }
    }
}
