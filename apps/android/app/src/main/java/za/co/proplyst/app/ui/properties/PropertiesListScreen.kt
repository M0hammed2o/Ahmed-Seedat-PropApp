package za.co.proplyst.app.ui.properties

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
import za.co.proplyst.app.ui.common.CachedDataBanner
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView

/** NATIVE_ANDROID_SPEC.md §3's PropertyListView -> LazyColumn (§3's iOS/Android naming table). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PropertiesListScreen(
    onPropertyClick: (String) -> Unit,
    viewModel: PropertiesListViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = { TopAppBar(title = { Text("Properties") }) },
    ) { padding ->
        when (val state = uiState) {
            is PropertiesListUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is PropertiesListUiState.Empty -> EmptyStateView(
                title = state.message,
                modifier = Modifier.padding(padding),
            )
            is PropertiesListUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            is PropertiesListUiState.Loaded -> Column(modifier = Modifier.padding(padding)) {
                if (state.cachedAt != null) {
                    CachedDataBanner(relativeTime = state.cachedAt)
                }
                LazyColumn {
                    items(state.properties, key = { it.id }) { property ->
                        ListItem(
                            headlineContent = { Text(property.nickname) },
                            supportingContent = { Text(property.fullAddress) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onPropertyClick(property.id) },
                        )
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}
