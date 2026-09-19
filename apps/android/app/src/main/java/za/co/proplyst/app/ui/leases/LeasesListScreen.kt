package za.co.proplyst.app.ui.leases

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.ui.common.CachedDataBanner
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView
import za.co.proplyst.app.ui.common.ProplystScreenScaffold
import za.co.proplyst.app.ui.common.toneForStatus
import za.co.proplyst.app.ui.common.StatusChip
import za.co.proplyst.app.ui.common.ProplystListSpacing
import za.co.proplyst.app.ui.common.ProplystListPadding
import za.co.proplyst.app.ui.common.ProplystRecordCard

/** View-only, scoped to a unit -- same shape as UnitsListScreen being scoped to a property. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LeasesListScreen(
    onBack: () -> Unit,
    onLeaseClick: (String) -> Unit,
    viewModel: LeasesListViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    ProplystScreenScaffold(
        title = "Leases",
        eyebrow = "Property",
        onBack = onBack,
    ) { padding ->
        when (val state = uiState) {
            is LeasesListUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is LeasesListUiState.Empty -> EmptyStateView(
                title = state.message,
                modifier = Modifier.padding(padding),
            )
            is LeasesListUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            is LeasesListUiState.Loaded -> Column(modifier = Modifier.padding(padding)) {
                if (state.cachedAt != null) {
                    CachedDataBanner(relativeTime = state.cachedAt)
                }
                LazyColumn(
                    contentPadding = ProplystListPadding,
                    verticalArrangement = ProplystListSpacing,
                ) {
                    items(state.leases, key = { it.id }) { lease ->
                        val status = lease.status.replace('_', ' ')
                        ProplystRecordCard(
                            title = "${lease.startDate} — ${lease.endDate ?: "Ongoing"}",
                            meta = "Lease period",
                            onClick = { onLeaseClick(lease.id) },
                            chips = {
                                StatusChip(
                                    label = status.replaceFirstChar { it.uppercase() },
                                    tone = toneForStatus(status),
                                )
                            },
                        )
                    }
                }
            }
        }
    }
}
