package za.co.proplyst.app.ui.units

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

/** View-only per MOBILE_ARCHITECTURE_DECISION.md §6's native-app scope ("Units (view)") -- no
 * create/edit UI, matching PropertiesListScreen's own read-only-list-first shape. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UnitsListScreen(
    onBack: () -> Unit,
    onUnitClick: (String) -> Unit,
    viewModel: UnitsListViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Units") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        when (val state = uiState) {
            is UnitsListUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is UnitsListUiState.Empty -> EmptyStateView(
                title = state.message,
                modifier = Modifier.padding(padding),
            )
            is UnitsListUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            is UnitsListUiState.Loaded -> Column(modifier = Modifier.padding(padding)) {
                if (state.cachedAt != null) {
                    CachedDataBanner(relativeTime = state.cachedAt)
                }
                LazyColumn {
                    items(state.units, key = { it.id }) { unit ->
                        ListItem(
                            headlineContent = { Text(unit.unitLabel) },
                            supportingContent = { Text(unit.status.replace('_', ' ')) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onUnitClick(unit.id) },
                        )
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}
