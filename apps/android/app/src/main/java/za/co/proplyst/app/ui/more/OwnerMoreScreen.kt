package za.co.proplyst.app.ui.more

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.filled.RequestQuote
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Summarize
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.ui.dashboard.DashboardViewModel
import za.co.proplyst.app.ui.theme.ProplystTheme

private const val WEB_BILLING_URL = "https://proplyst.co.za/organization/billing"

/**
 * Owner "More" (Proplyst Mobile Design System redesign pass) -- clean list access to every
 * secondary module the old 8-tab bottom nav used to expose directly (design handoff §"Owner More",
 * not individually mocked -- built as a natural extension of the approved Navy Deck list-row
 * pattern already used by [za.co.proplyst.app.ui.account.AccountScreen]). Nothing here is new
 * functionality; every row routes to an existing, already-working screen.
 */
@Composable
fun OwnerMoreScreen(
    onInvoicesClick: () -> Unit,
    onTenantsClick: () -> Unit,
    onPaymentReviewClick: () -> Unit,
    onMaintenanceClick: () -> Unit,
    onNoticesClick: () -> Unit,
    onSummaryClick: () -> Unit,
    onAccountClick: () -> Unit,
    onAppearanceClick: () -> Unit,
    viewModel: DashboardViewModel = hiltViewModel(),
) {
    val isPrincipal by viewModel.isPrincipal.collectAsState()
    val context = LocalContext.current

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(ProplystTheme.colors.navy)
                .statusBarsPadding()
                .padding(top = 20.dp, start = 20.dp, end = 20.dp, bottom = 18.dp),
        ) {
            Text("More", style = ProplystTheme.type.screenTitle, color = androidx.compose.ui.graphics.Color.White)
        }
        LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp)) {
            item { MoreSectionLabel("Portfolio") }
            item { MoreRow("Invoices & payments", "The authoritative payment ledger", Icons.Filled.RequestQuote, onInvoicesClick) }
            item { MoreRow("Tenants", "Everyone renting across your portfolio", Icons.Filled.People, onTenantsClick) }
            item { MoreRow("Payment review", "Confirm or reject reported payments", Icons.Filled.Receipt, onPaymentReviewClick) }
            item { MoreRow("Maintenance", "Every open and completed request", Icons.Filled.Build, onMaintenanceClick) }
            item { MoreRow("Notices", "Announcements sent to tenants", Icons.Filled.Notifications, onNoticesClick) }
            item { MoreRow("Reports & summary", "Monthly portfolio summaries", Icons.Filled.Summarize, onSummaryClick) }
            item { Spacer(modifier = Modifier.height(16.dp)) }
            item { MoreSectionLabel("Account") }
            if (isPrincipal) {
                item {
                    MoreRow(
                        "Manage subscription",
                        "Billing and plan (opens in browser)",
                        Icons.Filled.CreditCard,
                        onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(WEB_BILLING_URL))) },
                    )
                }
            }
            item { MoreRow("Account & security", "Sign out, biometric app lock", Icons.Filled.Security, onAccountClick) }
            item { MoreRow("Appearance", "Light, dark, or system", Icons.Filled.Palette, onAppearanceClick) }
            item { MoreRow("Help", "Contact Proplyst support", Icons.AutoMirrored.Filled.HelpOutline, onAccountClick) }
            item { Spacer(modifier = Modifier.height(48.dp)) }
        }
    }
}

@Composable
private fun MoreSectionLabel(text: String) {
    Text(
        text.uppercase(),
        style = ProplystTheme.type.statusLabel,
        color = ProplystTheme.colors.textTertiary,
        modifier = Modifier.padding(bottom = 8.dp, top = 4.dp),
    )
}

@Composable
private fun MoreRow(title: String, description: String, icon: ImageVector, onClick: () -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(14.dp),
        shadowElevation = 1.dp,
        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp).clickable(onClick = onClick),
    ) {
        Row(modifier = Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(ProplystTheme.colors.blueTint),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = ProplystTheme.colors.primary, modifier = Modifier.size(18.dp))
            }
            Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
                Text(title, style = ProplystTheme.type.cardTitle.copy(fontSize = 15.sp))
                Text(description, style = ProplystTheme.type.caption, color = ProplystTheme.colors.textSecondary)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = ProplystTheme.colors.textTertiary)
        }
    }
}
