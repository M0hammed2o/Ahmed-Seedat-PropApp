package com.propertyvault.app.ui.tenants

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

/** View-only, org-wide list -- mirrors apps/admin's own /tenants (not property-nested). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TenantsListScreen(
    onTenantClick: (String) -> Unit,
    viewModel: TenantsListViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = { TopAppBar(title = { Text("Tenants") }) },
    ) { padding ->
        when (val state = uiState) {
            is TenantsListUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is TenantsListUiState.Empty -> EmptyStateView(
                title = state.message,
                modifier = Modifier.padding(padding),
            )
            is TenantsListUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            is TenantsListUiState.Loaded -> Column(modifier = Modifier.padding(padding)) {
                if (state.cachedAt != null) {
                    CachedDataBanner(relativeTime = state.cachedAt)
                }
                LazyColumn {
                    items(state.tenants, key = { it.id }) { tenant ->
                        ListItem(
                            headlineContent = { Text(tenant.fullName) },
                            supportingContent = { Text(tenant.email ?: tenant.phone ?: "") },
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onTenantClick(tenant.id) },
                        )
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}
