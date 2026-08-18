package za.co.proplyst.app.ui.dashboard

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CreditCard
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

/** The production Proplyst web app's own billing/subscription-management page (PERMISSIONS.md:
 *  principal-only) -- Android V1 deliberately does not implement Google Play Billing (subscription
 *  purchasing stays on the web; see SUBSCRIPTIONS.md's Android Play-policy note), so "Manage
 *  subscription" always opens this page in the device browser rather than any in-app purchase
 *  flow. */
private const val WEB_BILLING_URL = "https://proplyst.co.za/organization/billing"

/**
 * Placeholder using the real navigation architecture (NATIVE_ANDROID_SPEC.md §2's OwnerTabView
 * Tab 1) -- KPI cards (portfolio_insights-backed, matching M18's Portfolio Intelligence feed) are
 * a separate, not-yet-built vertical slice; this proves the tab/nav shell renders correctly for
 * this first slice's actual verification target (TASKS.md M22).
 *
 * V1 billing invoice pass (WORKLOG.md this date), Phase 12: also hosts the "Manage subscription"
 * entry point -- the smallest safe owner-facing Android billing action, gated to org principals
 * only (DashboardViewModel.isPrincipal) and opening the web billing page via a plain HTTPS Intent,
 * never Google Play Billing.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(viewModel: DashboardViewModel = hiltViewModel()) {
    val isPrincipal by viewModel.isPrincipal.collectAsState()
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
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            verticalArrangement = Arrangement.Top,
        ) {
            Text(
                "Portfolio KPIs land here once the Portfolio Intelligence feed (M18) is wired into this app -- not yet built.",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}
