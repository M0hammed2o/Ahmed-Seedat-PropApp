package za.co.proplyst.app.ui.tenancy

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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.automirrored.filled.ReceiptLong
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.announcements.Announcement
import za.co.proplyst.app.data.maintenance.MaintenanceTicket
import za.co.proplyst.app.data.paymentreports.PaymentReport
import za.co.proplyst.app.data.tenancy.TenancyLease
import za.co.proplyst.app.data.tenancy.TenancyLeaseResult
import za.co.proplyst.app.ui.common.formatCurrency
import za.co.proplyst.app.ui.theme.ProplystTheme
import java.time.LocalDate

/**
 * Tenant Home (Proplyst Mobile Design System redesign pass, approved Navy Deck direction) --
 * navy hero with the caller's outstanding balance (server-authoritative, [TenantHomeViewModel
 * .outstandingInvoice], never recomputed here), "Report payment" CTA (explicitly NOT labelled
 * "Pay now" -- design handoff §"Tenant Home", this product has no payment-provider flow, only the
 * existing tenant-reported-claim workflow, kept clearly distinct from the invoice ledger), lease
 * progress, last payment, and previews of My requests / Building notices.
 */
@Composable
fun TenantHomeScreen(
    onNotificationsClick: () -> Unit,
    onReportPaymentClick: () -> Unit,
    onInvoicesClick: () -> Unit,
    onRequestsClick: () -> Unit,
    onNoticesClick: () -> Unit,
    viewModel: TenantHomeViewModel = hiltViewModel(),
) {
    val leaseState by viewModel.leaseUiState.collectAsState()
    val outstandingInvoiceBalance by viewModel.outstandingInvoice.collectAsState()
    val lastPayment by viewModel.lastPayment.collectAsState()
    val myRequests by viewModel.myRequests.collectAsState()
    val notices by viewModel.notices.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        LazyColumn(modifier = Modifier.fillMaxSize()) {
            item {
                TenantNavyHero(
                    lease = (leaseState as? TenancyLeaseResult.Loaded)?.lease,
                    outstandingBalance = outstandingInvoiceBalance?.balance,
                    outstandingLabel = outstandingInvoiceBalance?.description,
                    isLoading = isLoading,
                    onNotificationsClick = onNotificationsClick,
                )
            }
            item {
                ReportPaymentCard(onReportPaymentClick = onReportPaymentClick, onInvoicesClick = onInvoicesClick)
            }
            item { Spacer(modifier = Modifier.height(16.dp)) }
            item {
                Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    LeaseProgressCard(lease = (leaseState as? TenancyLeaseResult.Loaded)?.lease, modifier = Modifier.weight(1f))
                    LastPaymentCard(payment = lastPayment, modifier = Modifier.weight(1f))
                }
            }
            item { Spacer(modifier = Modifier.height(20.dp)) }
            item { PreviewSection(title = "My requests", items = myRequests.map { it.summary to it.status }, onSeeAll = onRequestsClick, icon = Icons.Filled.Build) }
            item { Spacer(modifier = Modifier.height(20.dp)) }
            item { PreviewSection(title = "Building notices", items = notices.map { it.title to null }, onSeeAll = onNoticesClick, icon = Icons.Filled.Campaign) }
            item { Spacer(modifier = Modifier.height(96.dp)) }
        }
    }
}

@Composable
private fun TenantNavyHero(
    lease: TenancyLease?,
    outstandingBalance: Double?,
    outstandingLabel: String?,
    isLoading: Boolean,
    onNotificationsClick: () -> Unit,
) {
    Box(modifier = Modifier.fillMaxWidth().background(ProplystTheme.colors.navy).statusBarsPadding().padding(bottom = 48.dp)) {
        Column(modifier = Modifier.padding(top = 20.dp, start = 20.dp, end = 20.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Prop", style = MaterialTheme.typography.titleMedium, color = Color.White, fontWeight = FontWeight.Bold)
                    Text("lyst", style = MaterialTheme.typography.titleMedium, color = ProplystTheme.colors.primaryLightOnNavy, fontWeight = FontWeight.Bold)
                }
                Surface(shape = CircleShape, color = Color.White.copy(alpha = 0.08f), modifier = Modifier.size(40.dp)) {
                    IconButton(onClick = onNotificationsClick) {
                        Icon(Icons.Filled.Notifications, contentDescription = "Notifications", tint = Color.White)
                    }
                }
            }
            Spacer(modifier = Modifier.height(20.dp))
            Text("Hi there", style = ProplystTheme.type.greeting, color = ProplystTheme.colors.navySecondaryOn)
            if (lease != null && (lease.propertyNickname != null || lease.unitLabel != null)) {
                Text(
                    listOfNotNull(lease.propertyNickname, lease.unitLabel).joinToString(" · "),
                    style = ProplystTheme.type.caption,
                    color = ProplystTheme.colors.navyTertiaryOn,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            Spacer(modifier = Modifier.height(16.dp))
            when {
                isLoading -> CircularProgressIndicator(color = Color.White, modifier = Modifier.size(28.dp))
                outstandingBalance != null -> {
                    Text(outstandingLabel ?: "Outstanding balance", style = ProplystTheme.type.caption, color = ProplystTheme.colors.navyTertiaryOn)
                    Text("R${formatCurrency(outstandingBalance)}", style = ProplystTheme.type.financialHero, color = Color.White, modifier = Modifier.padding(top = 2.dp))
                }
                else -> {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = ProplystTheme.colors.success, modifier = Modifier.size(22.dp))
                        Text("You're all caught up", style = MaterialTheme.typography.titleLarge, color = Color.White, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 8.dp))
                    }
                    if (lease?.rentAmount != null) {
                        Text("Monthly rent R${formatCurrency(lease.rentAmount)}", style = ProplystTheme.type.caption, color = ProplystTheme.colors.navyTertiaryOn, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun ReportPaymentCard(onReportPaymentClick: () -> Unit, onInvoicesClick: () -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(18.dp),
        shadowElevation = 3.dp,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp).offset(y = (-40).dp),
    ) {
        Row(modifier = Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Button(
                onClick = onReportPaymentClick,
                colors = ButtonDefaults.buttonColors(containerColor = ProplystTheme.colors.primary),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.weight(1f).height(50.dp),
            ) {
                Text("Report payment", fontWeight = FontWeight.Bold)
            }
            Spacer(modifier = Modifier.width(12.dp))
            Surface(color = ProplystTheme.colors.blueTint, shape = RoundedCornerShape(14.dp), modifier = Modifier.size(50.dp)) {
                IconButton(onClick = onInvoicesClick) {
                    Icon(Icons.AutoMirrored.Filled.ReceiptLong, contentDescription = "View invoices", tint = ProplystTheme.colors.primary)
                }
            }
        }
    }
}

@Composable
private fun LeaseProgressCard(lease: TenancyLease?, modifier: Modifier = Modifier) {
    val progress = leaseProgress(lease?.startDate, lease?.endDate)
    Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(16.dp), shadowElevation = 1.dp, modifier = modifier) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text("Lease progress", style = ProplystTheme.type.caption, color = ProplystTheme.colors.textSecondary)
            Text(lease?.leaseStatus?.replaceFirstChar { it.uppercase() } ?: "—", style = ProplystTheme.type.cardTitle.copy(fontSize = 16.sp), modifier = Modifier.padding(top = 2.dp))
            if (progress != null) {
                Spacer(modifier = Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier.fillMaxWidth().height(5.dp),
                    color = ProplystTheme.colors.primary,
                    trackColor = ProplystTheme.colors.divider,
                )
            }
        }
    }
}

@Composable
private fun LastPaymentCard(payment: PaymentReport?, modifier: Modifier = Modifier) {
    Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(16.dp), shadowElevation = 1.dp, modifier = modifier) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text("Last payment", style = ProplystTheme.type.caption, color = ProplystTheme.colors.textSecondary)
            if (payment != null) {
                Text("R${formatCurrency(payment.amount)}", style = ProplystTheme.type.cardTitle.copy(fontSize = 16.sp), modifier = Modifier.padding(top = 2.dp))
                Text("Confirmed · ${payment.paymentDate}", style = ProplystTheme.type.caption, color = ProplystTheme.colors.success, modifier = Modifier.padding(top = 2.dp))
            } else {
                Text("No confirmed payments yet", style = ProplystTheme.type.caption, color = ProplystTheme.colors.textTertiary, modifier = Modifier.padding(top = 2.dp))
            }
        }
    }
}

@Composable
private fun PreviewSection(title: String, items: List<Pair<String, String?>>, onSeeAll: () -> Unit, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    if (items.isEmpty()) return
    Column(modifier = Modifier.padding(horizontal = 20.dp)) {
        Row(modifier = Modifier.fillMaxWidth().clickable(onClick = onSeeAll), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = ProplystTheme.type.sectionHeading)
            Text("See all", style = ProplystTheme.type.captionEmphasis, color = ProplystTheme.colors.primary)
        }
        Spacer(modifier = Modifier.height(10.dp))
        Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(16.dp), shadowElevation = 1.dp) {
            Column {
                items.forEachIndexed { index, (label, status) ->
                    Row(modifier = Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(modifier = Modifier.size(34.dp).background(ProplystTheme.colors.blueTint, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                            Icon(icon, contentDescription = null, tint = ProplystTheme.colors.primary, modifier = Modifier.size(16.dp))
                        }
                        Text(label, style = ProplystTheme.type.body, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 12.dp).weight(1f))
                        if (status != null) {
                            Surface(color = ProplystTheme.colors.blueTint, shape = RoundedCornerShape(50)) {
                                Text(status, style = ProplystTheme.type.statusLabel, color = ProplystTheme.colors.primary, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp))
                            }
                        }
                    }
                    if (index != items.lastIndex) {
                        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(ProplystTheme.colors.divider))
                    }
                }
            }
        }
    }
}

private fun leaseProgress(startDate: String?, endDate: String?): Float? {
    if (startDate == null || endDate == null) return null
    return try {
        val start = LocalDate.parse(startDate)
        val end = LocalDate.parse(endDate)
        val today = LocalDate.now()
        val totalDays = java.time.temporal.ChronoUnit.DAYS.between(start, end).toFloat()
        if (totalDays <= 0) return null
        val elapsedDays = java.time.temporal.ChronoUnit.DAYS.between(start, today).toFloat()
        (elapsedDays / totalDays).coerceIn(0f, 1f)
    } catch (_: Exception) {
        null
    }
}
