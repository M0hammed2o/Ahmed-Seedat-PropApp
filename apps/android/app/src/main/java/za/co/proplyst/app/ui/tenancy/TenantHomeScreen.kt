package za.co.proplyst.app.ui.tenancy

import androidx.compose.foundation.Image
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.R
import za.co.proplyst.app.data.maintenance.MaintenanceTicket
import za.co.proplyst.app.data.tenancy.TenancyLease
import za.co.proplyst.app.data.tenancy.TenancyLeaseResult
import za.co.proplyst.app.ui.common.PropertyPhoto
import za.co.proplyst.app.ui.common.formatCurrency
import za.co.proplyst.app.ui.common.navyHeaderGlow
import za.co.proplyst.app.ui.common.relativeTimeLabel
import za.co.proplyst.app.ui.theme.ProplystTheme
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Tenant Home (fidelity audit §5, `B-TenantHome.dc.html` platform=android) -- mark + wordmark
 * header with bordered bell and avatar, one-line greeting with unit context, the rent hero with a
 * status line (kept "R 0" when caught up so the amount slot stays stable), the −48 dp action card
 * with its "Payment reported ✓" state, lease-months / last-payment stat cards, request cards with
 * thumbnails and status pills, restyled notices, and a documents entry point. "Report payment"
 * stays a report -- never "Pay now" (no payment provider exists).
 */
@Composable
fun TenantHomeScreen(
    onNotificationsClick: () -> Unit,
    onReportPaymentClick: () -> Unit,
    onInvoicesClick: () -> Unit,
    onRequestsClick: () -> Unit,
    onNewRequestClick: () -> Unit,
    onNoticesClick: () -> Unit,
    onDocumentsClick: () -> Unit,
    onAccountClick: () -> Unit,
    viewModel: TenantHomeViewModel = hiltViewModel(),
) {
    val leaseState by viewModel.leaseUiState.collectAsState()
    val outstandingInvoice by viewModel.outstandingInvoice.collectAsState()
    val lastPayment by viewModel.lastPayment.collectAsState()
    val hasPendingReport by viewModel.hasPendingReport.collectAsState()
    val myRequests by viewModel.myRequests.collectAsState()
    val notices by viewModel.notices.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val lease = (leaseState as? TenancyLeaseResult.Loaded)?.lease

    Column(modifier = Modifier.fillMaxSize().background(colors.background)) {
        LazyColumn(modifier = Modifier.fillMaxSize()) {
            item {
                TenantNavyHero(
                    lease = lease,
                    outstandingBalance = outstandingInvoice?.balance,
                    outstandingLabel = outstandingInvoice?.description,
                    hasPendingReport = hasPendingReport,
                    isLoading = isLoading,
                    accountEmail = viewModel.accountEmail,
                    onNotificationsClick = onNotificationsClick,
                    onAccountClick = onAccountClick,
                )
            }
            item {
                ReportPaymentCard(
                    hasPendingReport = hasPendingReport,
                    onReportPaymentClick = onReportPaymentClick,
                    onInvoicesClick = onInvoicesClick,
                )
            }
            item { Spacer(modifier = Modifier.height(16.dp)) }
            item {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    LeaseProgressCard(lease = lease, modifier = Modifier.weight(1f))
                    LastPaymentCard(
                        amount = lastPayment?.amount,
                        date = lastPayment?.paymentDate,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            item { Spacer(modifier = Modifier.height(24.dp)) }
            item {
                SectionHeader(title = "My requests", action = "New request", onAction = onNewRequestClick)
            }
            item { Spacer(modifier = Modifier.height(12.dp)) }
            if (myRequests.isEmpty()) {
                item {
                    Text(
                        "No maintenance requests yet.",
                        style = type.caption,
                        color = colors.textTertiary,
                        modifier = Modifier.padding(horizontal = 20.dp),
                    )
                }
            } else {
                item {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(horizontal = 20.dp),
                    ) {
                        myRequests.forEach { RequestCard(ticket = it, onClick = onRequestsClick) }
                    }
                }
            }
            item { Spacer(modifier = Modifier.height(24.dp)) }
            item { SectionHeader(title = "Building notices", action = "See all", onAction = onNoticesClick) }
            item { Spacer(modifier = Modifier.height(12.dp)) }
            if (notices.isNotEmpty()) {
                item {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(horizontal = 20.dp),
                    ) {
                        notices.forEach { notice -> NoticeCard(title = notice.title, body = notice.body, onClick = onNoticesClick) }
                    }
                }
            } else {
                item {
                    Text(
                        "No notices right now.",
                        style = type.caption,
                        color = colors.textTertiary,
                        modifier = Modifier.padding(horizontal = 20.dp),
                    )
                }
            }
            item { Spacer(modifier = Modifier.height(24.dp)) }
            item { SectionHeader(title = "Important documents", action = null, onAction = null) }
            item { Spacer(modifier = Modifier.height(12.dp)) }
            item {
                // The mock shows two named shortcuts ("Lease agreement" / "House rules"); real
                // document names vary per tenancy and there is no doc-type tagging to resolve
                // them, so one honest entry point replaces two fabricated ones.
                Surface(
                    color = colors.surface,
                    shape = RoundedCornerShape(14.dp),
                    border = BorderStroke(1.dp, colors.border),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp)
                        .clickable(onClick = onDocumentsClick),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
                        Icon(Icons.Outlined.Description, contentDescription = null, tint = colors.primary, modifier = Modifier.size(18.dp))
                        Text(
                            "View my documents",
                            style = type.captionEmphasis,
                            color = colors.textPrimary,
                            modifier = Modifier.padding(start = 10.dp),
                        )
                    }
                }
            }
            item { Spacer(modifier = Modifier.height(110.dp)) }
        }
    }
}

@Composable
private fun SectionHeader(title: String, action: String?, onAction: (() -> Unit)?) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = type.sectionHeading, color = colors.textPrimary)
        if (action != null && onAction != null) {
            Text(
                action,
                style = type.captionEmphasis,
                color = colors.primary,
                modifier = Modifier.clickable(onClick = onAction),
            )
        }
    }
}

@Composable
private fun TenantNavyHero(
    lease: TenancyLease?,
    outstandingBalance: Double?,
    outstandingLabel: String?,
    hasPendingReport: Boolean,
    isLoading: Boolean,
    accountEmail: String?,
    onNotificationsClick: () -> Unit,
    onAccountClick: () -> Unit,
) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.navy)
            .navyHeaderGlow()
            .statusBarsPadding()
            .padding(bottom = 70.dp),
    ) {
        Column(modifier = Modifier.padding(top = 10.dp, start = 20.dp, end = 20.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Image(
                        painter = painterResource(R.drawable.proplyst_logo_mark),
                        contentDescription = null,
                        modifier = Modifier.height(26.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Prop", style = type.wordmark, color = Color.White)
                    Text("lyst", style = type.wordmark, color = colors.primaryLightOnNavy)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .size(40.dp)
                            .background(Color.White.copy(alpha = 0.06f), CircleShape)
                            .border(1.dp, Color.White.copy(alpha = 0.14f), CircleShape)
                            .clickable(onClick = onNotificationsClick),
                    ) {
                        Icon(
                            Icons.Outlined.Notifications,
                            contentDescription = "Notifications",
                            tint = Color.White,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .size(40.dp)
                            .background(colors.primary, CircleShape)
                            .clickable(onClick = onAccountClick),
                    ) {
                        Text(
                            accountEmail?.firstOrNull()?.uppercase() ?: "•",
                            style = type.captionEmphasis.copy(fontWeight = FontWeight.Bold),
                            color = Color.White,
                        )
                    }
                }
            }
            Spacer(modifier = Modifier.height(20.dp))
            val contextLine = listOfNotNull(
                "Hi there",
                lease?.propertyNickname,
                lease?.unitLabel,
            ).joinToString(" · ")
            Text(contextLine, style = type.body, color = colors.navySecondaryOn, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(modifier = Modifier.height(10.dp))
            when {
                isLoading -> CircularProgressIndicator(color = Color.White, modifier = Modifier.size(28.dp))
                else -> {
                    Text(
                        outstandingLabel ?: "Rent",
                        style = type.caption,
                        color = colors.navySecondaryOn,
                    )
                    Text(
                        "R ${formatCurrency(outstandingBalance ?: 0.0)}",
                        style = type.financialHero,
                        color = Color.White,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                    Text(
                        when {
                            hasPendingReport -> "Payment reported · awaiting confirmation"
                            outstandingBalance != null -> "Outstanding balance"
                            else -> "Up to date"
                        },
                        style = type.body,
                        color = colors.navySecondaryOn,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ReportPaymentCard(
    hasPendingReport: Boolean,
    onReportPaymentClick: () -> Unit,
    onInvoicesClick: () -> Unit,
) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Surface(
        color = colors.surface,
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .offset(y = (-48).dp)
            .shadow(8.dp, RoundedCornerShape(18.dp), ambientColor = colors.navy.copy(alpha = 0.10f), spotColor = colors.navy.copy(alpha = 0.10f)),
    ) {
        Row(modifier = Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            if (hasPendingReport) {
                Surface(
                    color = colors.blueTint,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.weight(1f).height(50.dp),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        Icon(Icons.Filled.Check, contentDescription = null, tint = colors.primary, modifier = Modifier.size(18.dp))
                        Text(
                            "Payment reported",
                            style = type.buttonSecondary.copy(fontWeight = FontWeight.Bold),
                            color = colors.primary,
                            modifier = Modifier.padding(start = 8.dp),
                        )
                    }
                }
            } else {
                Button(
                    onClick = onReportPaymentClick,
                    colors = ButtonDefaults.buttonColors(containerColor = colors.primary, contentColor = Color.White),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.weight(1f).height(50.dp),
                ) {
                    Text("Report payment", style = type.buttonSecondary.copy(fontWeight = FontWeight.Bold))
                }
            }
            Spacer(modifier = Modifier.width(12.dp))
            Surface(
                color = colors.surface,
                border = BorderStroke(1.dp, colors.border),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.size(50.dp).clickable(onClick = onInvoicesClick),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.AutoMirrored.Outlined.ReceiptLong,
                        contentDescription = "View invoices",
                        tint = colors.navyText,
                        modifier = Modifier.size(22.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun LeaseProgressCard(lease: TenancyLease?, modifier: Modifier = Modifier) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val months = leaseMonths(lease?.startDate, lease?.endDate)
    Surface(
        color = colors.surface,
        shape = RoundedCornerShape(16.dp),
        modifier = modifier.shadow(1.dp, RoundedCornerShape(16.dp), ambientColor = colors.navy.copy(alpha = 0.10f), spotColor = colors.navy.copy(alpha = 0.10f)),
    ) {
        Column(modifier = Modifier.padding(vertical = 14.dp, horizontal = 16.dp)) {
            Text("Lease progress", style = type.meta, color = colors.textSecondary)
            if (months != null) {
                Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(top = 4.dp)) {
                    Text("${months.first} / ${months.second}", style = type.kpiValue, color = colors.textPrimary)
                    Text(" mo", style = type.captionEmphasis, color = colors.textTertiary)
                }
                Spacer(modifier = Modifier.height(10.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(5.dp)
                        .clip(RoundedCornerShape(50))
                        .background(colors.divider),
                ) {
                    val fraction = (months.first.toFloat() / months.second).coerceIn(0f, 1f)
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(fraction)
                            .height(5.dp)
                            .background(colors.primary, RoundedCornerShape(50)),
                    )
                }
            } else {
                Text(
                    lease?.leaseStatus?.replaceFirstChar { it.uppercase() } ?: "—",
                    style = type.kpiValue,
                    color = colors.textPrimary,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun LastPaymentCard(amount: Double?, date: String?, modifier: Modifier = Modifier) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Surface(
        color = colors.surface,
        shape = RoundedCornerShape(16.dp),
        modifier = modifier.shadow(1.dp, RoundedCornerShape(16.dp), ambientColor = colors.navy.copy(alpha = 0.10f), spotColor = colors.navy.copy(alpha = 0.10f)),
    ) {
        Column(modifier = Modifier.padding(vertical = 14.dp, horizontal = 16.dp)) {
            Text("Last payment", style = type.meta, color = colors.textSecondary)
            if (amount != null) {
                Text("R ${formatCurrency(amount)}", style = type.kpiValue, color = colors.textPrimary, modifier = Modifier.padding(top = 4.dp))
                Text(
                    "Confirmed · ${date.orEmpty()}",
                    style = type.meta.copy(fontWeight = FontWeight.SemiBold),
                    color = colors.successText,
                    modifier = Modifier.padding(top = 8.dp),
                )
            } else {
                Text("—", style = type.kpiValue, color = colors.textTertiary, modifier = Modifier.padding(top = 4.dp))
                Text("No confirmed payments yet", style = type.meta, color = colors.textTertiary, modifier = Modifier.padding(top = 8.dp))
            }
        }
    }
}

@Composable
private fun RequestCard(ticket: MaintenanceTicket, onClick: () -> Unit) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val (pillBg, pillText, pillLabel) = when (ticket.status) {
        "in_progress" -> Triple(colors.blueTint, colors.primary, "In progress")
        "completed", "done" -> Triple(colors.successBg, colors.successText, "Completed")
        else -> Triple(colors.divider, colors.textSecondary, ticket.status.replace('_', ' ').replaceFirstChar { it.uppercase() })
    }
    Surface(
        color = colors.surface,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier
            .fillMaxWidth()
            .shadow(1.dp, RoundedCornerShape(16.dp), ambientColor = colors.navy.copy(alpha = 0.10f), spotColor = colors.navy.copy(alpha = 0.10f))
            .clickable(onClick = onClick),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 12.dp, horizontal = 16.dp)) {
            Box(modifier = Modifier.size(44.dp).clip(RoundedCornerShape(12.dp))) {
                PropertyPhoto(imageUrl = null, contentDescription = null, modifier = Modifier.fillMaxSize())
            }
            Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
                Text(ticket.summary, style = type.cardTitle, color = colors.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(relativeTimeLabel(ticket.createdAt), style = type.meta, color = colors.textTertiary, modifier = Modifier.padding(top = 2.dp))
            }
            Surface(color = pillBg, shape = RoundedCornerShape(50)) {
                Text(
                    pillLabel,
                    style = type.meta.copy(fontWeight = FontWeight.SemiBold),
                    color = pillText,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun NoticeCard(title: String, body: String, onClick: () -> Unit) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Surface(
        color = colors.surface,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier
            .fillMaxWidth()
            .shadow(1.dp, RoundedCornerShape(16.dp), ambientColor = colors.navy.copy(alpha = 0.10f), spotColor = colors.navy.copy(alpha = 0.10f))
            .clickable(onClick = onClick),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 12.dp, horizontal = 16.dp)) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier.size(36.dp).background(colors.navy, RoundedCornerShape(10.dp)),
            ) {
                Icon(Icons.Outlined.Info, contentDescription = null, tint = colors.primaryLightOnNavy, modifier = Modifier.size(18.dp))
            }
            Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
                Text(
                    title,
                    style = type.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                    color = colors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    body,
                    style = type.caption,
                    color = colors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
    }
}

/** Elapsed/total lease months for the "9 / 12 mo" stat -- plain date arithmetic on real lease
 * dates, null when there is no fixed term. */
private fun leaseMonths(startDate: String?, endDate: String?): Pair<Long, Long>? {
    if (startDate == null || endDate == null) return null
    return try {
        val start = LocalDate.parse(startDate)
        val end = LocalDate.parse(endDate)
        val total = ChronoUnit.MONTHS.between(start, end)
        if (total <= 0) return null
        val elapsed = ChronoUnit.MONTHS.between(start, LocalDate.now()).coerceIn(0, total)
        elapsed to total
    } catch (_: Exception) {
        null
    }
}
