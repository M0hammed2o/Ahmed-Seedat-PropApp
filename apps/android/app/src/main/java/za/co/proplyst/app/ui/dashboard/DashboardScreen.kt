package za.co.proplyst.app.ui.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Placeholder using the real navigation architecture (NATIVE_ANDROID_SPEC.md §2's OwnerTabView
 * Tab 1) -- KPI cards (portfolio_insights-backed, matching M18's Portfolio Intelligence feed) are
 * a separate, not-yet-built vertical slice; this proves the tab/nav shell renders correctly for
 * this first slice's actual verification target (TASKS.md M22).
 */
@Composable
fun DashboardScreen() {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Top,
    ) {
        Text("Dashboard", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Portfolio KPIs land here once the Portfolio Intelligence feed (M18) is wired into this app -- not yet built.",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}
