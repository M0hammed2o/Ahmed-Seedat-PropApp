package za.co.proplyst.app.ui.more

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.automirrored.outlined.ShowChart
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.PieChart
import androidx.compose.material.icons.outlined.PriceCheck
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material.icons.outlined.WaterDrop
import androidx.compose.material.icons.outlined.RequestQuote
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Summarize
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.ui.common.navyHeaderGlow
import za.co.proplyst.app.ui.dashboard.DashboardViewModel
import za.co.proplyst.app.ui.theme.ProplystTheme

private const val SUPPORT_EMAIL = "notifications@genbridge.co.za"

/**
 * Owner "More" (fidelity audit §4 -- no dedicated mock; follows the Navy Deck list pattern with
 * `B-Auth` `settings-enabled` as the reference): navy eyebrow header, account card first, rows
 * GROUPED into one white card per section with hairline dividers, 40 dp glyph squares, outlined
 * icons, and a destructive Sign out row. Every row routes to an existing, already-working screen.
 */
@Composable
fun OwnerMoreScreen(
    onInvoicesClick: () -> Unit,
    onTenantsClick: () -> Unit,
    onPaymentReviewClick: () -> Unit,
    onRentStatusClick: () -> Unit,
    onAddExpenseClick: () -> Unit,
    onUtilityOverviewClick: () -> Unit,
    onUtilityCaptureClick: () -> Unit,
    onUtilityHistoryClick: () -> Unit,
    onBudgetClick: () -> Unit,
    onMaintenanceClick: () -> Unit,
    onNoticesClick: () -> Unit,
    onSummaryClick: () -> Unit,
    onAccountClick: () -> Unit,
    onAppearanceClick: () -> Unit,
    viewModel: DashboardViewModel = hiltViewModel(),
) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val context = LocalContext.current

    Column(modifier = Modifier.fillMaxSize().background(colors.background).verticalScroll(rememberScrollState())) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.navy)
                .navyHeaderGlow()
                .statusBarsPadding()
                .padding(top = 10.dp, start = 20.dp, end = 20.dp, bottom = 22.dp),
        ) {
            Text("Settings", style = type.meta, color = colors.navySecondaryOn)
            Text("More", style = type.settingsTitle, color = Color.White, modifier = Modifier.padding(top = 2.dp))
        }
        Column(modifier = Modifier.padding(horizontal = 20.dp)) {
            Spacer(modifier = Modifier.height(16.dp))

            // ---- Account card ----
            GroupCard {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(onClick = onAccountClick)
                        .padding(vertical = 14.dp, horizontal = 16.dp),
                ) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier.size(40.dp).background(colors.primary, CircleShape),
                    ) {
                        Text(
                            viewModel.accountEmail?.firstOrNull()?.uppercase() ?: "•",
                            style = type.captionEmphasis.copy(fontWeight = FontWeight.Bold),
                            color = Color.White,
                        )
                    }
                    Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
                        Text(viewModel.accountEmail ?: "Signed in", style = type.cardTitle, color = colors.textPrimary)
                        Text("Owner", style = type.meta, color = colors.textSecondary, modifier = Modifier.padding(top = 2.dp))
                    }
                    Icon(
                        Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                        contentDescription = null,
                        tint = colors.textTertiary,
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            SectionLabel("Portfolio")
            GroupCard {
                MoreRow("Invoices & payments", "The authoritative payment ledger", Icons.Outlined.RequestQuote, onInvoicesClick)
                RowDivider()
                MoreRow("Tenants", "Everyone renting across your portfolio", Icons.Outlined.People, onTenantsClick)
                RowDivider()
                MoreRow("Payment review", "Confirm or reject reported payments", Icons.Outlined.Receipt, onPaymentReviewClick)
                RowDivider()
                MoreRow("Rent status", "Who has paid, who hasn't", Icons.Outlined.PriceCheck, onRentStatusClick)
                RowDivider()
                MoreRow("Maintenance", "Every open and completed request", Icons.Outlined.Build, onMaintenanceClick)
                RowDivider()
                MoreRow("Notices", "Announcements sent to tenants", Icons.Outlined.Notifications, onNoticesClick)
                RowDivider()
                MoreRow("Reports & summary", "Monthly portfolio summaries", Icons.Outlined.Summarize, onSummaryClick)
            }

            Spacer(modifier = Modifier.height(16.dp))
            SectionLabel("Finances")
            GroupCard {
                MoreRow("Add expense", "Record a property operating expense", Icons.AutoMirrored.Outlined.ReceiptLong, onAddExpenseClick)
                RowDivider()
                MoreRow("Utility overview", "Responsibility, readings and usage per property", Icons.Outlined.WaterDrop, onUtilityOverviewClick)
                RowDivider()
                MoreRow("Utility reading", "Record a water or electricity meter reading", Icons.Outlined.WaterDrop, onUtilityCaptureClick)
                RowDivider()
                MoreRow("Utility history", "Consumption trends and unusual usage", Icons.AutoMirrored.Outlined.ShowChart, onUtilityHistoryClick)
                RowDivider()
                MoreRow("Budget", "Planned vs actual spend this month", Icons.Outlined.PieChart, onBudgetClick)
            }

            Spacer(modifier = Modifier.height(16.dp))
            SectionLabel("Account")
            GroupCard {
                // The "Manage subscription" row was removed for the Play v1.0 release. It opened
                // proplyst.co.za/organization/billing in the system browser, where PayFast took the
                // payment -- an in-app link leading to an alternative payment method, which Play's
                // Payments policy prohibits outright (§4 anti-steering), on top of §3 requiring
                // Play billing for subscription cloud software in the first place. Android ships
                // with no purchase surface at all: an organisation subscribes on the web, and
                // anyone already entitled simply signs in here and uses what their plan allows.
                // Nothing about web billing, PayFast or existing entitlements changed.
                MoreRow("Account & security", "Fingerprint unlock, session", Icons.Outlined.Security, onAccountClick)
                RowDivider()
                MoreRow("Appearance", "Light, dark, or system", Icons.Outlined.Palette, onAppearanceClick)
                RowDivider()
                // Release hygiene: this row promised "Contact Proplyst support" and then opened
                // the Account screen, which carries no support content of any kind -- a row that
                // did nothing it said it would. It now actually opens an email to support.
                MoreRow(
                    "Help",
                    "Email Proplyst support",
                    Icons.AutoMirrored.Outlined.HelpOutline,
                    onClick = {
                        val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$SUPPORT_EMAIL"))
                        // No email client on a bare emulator image is normal, not an error.
                        runCatching { context.startActivity(intent) }
                    },
                )
                RowDivider()
                MoreRow(
                    "Sign out",
                    "Ends your session on this device",
                    Icons.AutoMirrored.Outlined.Logout,
                    onClick = onAccountClick,
                    destructive = true,
                )
            }

            Spacer(modifier = Modifier.height(110.dp))
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text.uppercase(),
        style = ProplystTheme.type.chipLabel,
        color = ProplystTheme.colors.textTertiary,
        modifier = Modifier.padding(bottom = 8.dp),
    )
}

@Composable
private fun GroupCard(content: @Composable () -> Unit) {
    Surface(
        color = ProplystTheme.colors.surface,
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier
            .fillMaxWidth()
            .shadow(
                1.dp,
                RoundedCornerShape(18.dp),
                ambientColor = ProplystTheme.colors.navy.copy(alpha = 0.10f),
                spotColor = ProplystTheme.colors.navy.copy(alpha = 0.10f),
            ),
    ) {
        Column { content() }
    }
}

@Composable
private fun RowDivider() {
    Box(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(1.dp).background(ProplystTheme.colors.divider))
}

@Composable
private fun MoreRow(
    title: String,
    description: String,
    icon: ImageVector,
    onClick: () -> Unit,
    destructive: Boolean = false,
) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val tint = if (destructive) colors.criticalDeep else colors.primary
    val glyphBg = if (destructive) colors.criticalBgAlt else colors.blueTint
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp, horizontal = 16.dp),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.size(40.dp).background(glyphBg, RoundedCornerShape(12.dp)),
        ) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
        }
        Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
            Text(title, style = type.cardTitle, color = if (destructive) colors.criticalDeep else colors.textPrimary)
            Text(description, style = type.meta, color = colors.textSecondary, modifier = Modifier.padding(top = 2.dp))
        }
        Icon(
            Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            tint = colors.textTertiary,
            modifier = Modifier.size(16.dp),
        )
    }
}
