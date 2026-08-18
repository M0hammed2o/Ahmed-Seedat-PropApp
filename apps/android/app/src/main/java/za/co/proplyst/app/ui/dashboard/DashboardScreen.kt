package za.co.proplyst.app.ui.dashboard

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material3.Card
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.insights.PortfolioInsight
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView

/** The production Proplyst web app's own billing/subscription-management page (PERMISSIONS.md:
 *  principal-only) -- Android V1 deliberately does not implement Google Play Billing (subscription
 *  purchasing stays on the web; see SUBSCRIPTIONS.md's Android Play-policy note), so "Manage
 *  subscription" always opens this page in the device browser rather than any in-app purchase
 *  flow. */
private const val WEB_BILLING_URL = "https://proplyst.co.za/organization/billing"

/**
 * Real navigation architecture (NATIVE_ANDROID_SPEC.md §2's OwnerTabView Tab 1). Full KPI cards
 * (occupancy/revenue trend etc.) remain a separate, not-yet-built vertical slice -- this proves
 * the tab/nav shell renders correctly for this first slice's actual verification target
 * (TASKS.md M22).
 *
 * V1 billing invoice pass (WORKLOG.md this date), Phase 12: hosts the "Manage subscription" entry
 * point -- the smallest safe owner-facing Android billing action, gated to org principals only
 * (DashboardViewModel.isPrincipal) and opening the web billing page via a plain HTTPS Intent,
 * never Google Play Billing.
 *
 * Final pre-UAT engineering pass (WORKLOG.md this date), Part 5: the Portfolio Intelligence feed
 * (AI_ARCHITECTURE.md §2, a deterministic rules engine, never an LLM) now replaces the old
 * "not yet built" placeholder -- real data via DashboardViewModel.insightsUiState, the same
 * GET /api/v1/insights feed the web dashboard's PortfolioInsightsPanel.tsx shows. No dismiss
 * action here (web-only for V1, matching "do not redesign Android" -- this is a read view).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(viewModel: DashboardViewModel = hiltViewModel()) {
    val isPrincipal by viewModel.isPrincipal.collectAsState()
    val insightsState by viewModel.insightsUiState.collectAsState()
    val context = LocalContext.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Dashboard") },
                actions = {
                    if (isPrincipal) {
                        IconButton(
                            onClick = {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(WEB_BILLING_URL)))
                            },
                        ) {
                            Icon(Icons.Filled.CreditCard, contentDescription = "Manage subscription")
                        }
                    }
                },
            )
        },
    ) { padding ->
        when (val state = insightsState) {
            is InsightsUiState.Loading -> LoadingView(modifier = Modifier.padding(padding))
            is InsightsUiState.Empty -> EmptyStateView(
                title = "No portfolio insights right now",
                modifier = Modifier.padding(padding),
            )
            is InsightsUiState.Error -> ErrorStateView(
                message = state.message,
                onRetry = viewModel::loadInsights,
                modifier = Modifier.padding(padding),
            )
            is InsightsUiState.Loaded -> LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(state.insights, key = { it.id }) { insight -> InsightCard(insight) }
            }
        }
    }
}

@Composable
private fun InsightCard(insight: PortfolioInsight) {
    val color = when (insight.severity) {
        "urgent" -> MaterialTheme.colorScheme.error
        "warning" -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(
                insight.severity.replaceFirstChar { it.uppercase() },
                style = MaterialTheme.typography.labelMedium,
                color = color,
            )
            Text(
                insight.message,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}
