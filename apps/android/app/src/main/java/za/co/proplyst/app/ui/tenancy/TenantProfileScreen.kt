package za.co.proplyst.app.ui.tenancy

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Security
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.tenancy.TenancyLease
import za.co.proplyst.app.data.tenancy.TenancyLeaseResult
import za.co.proplyst.app.ui.common.formatCurrency
import za.co.proplyst.app.ui.theme.ProplystTheme

/**
 * Tenant Profile (Proplyst Mobile Design System redesign pass) -- identity/property/unit/lease
 * summary up top (reuses [za.co.proplyst.app.data.tenancy.TenancyRepository.getMyLease], the same
 * "My Lease" data source), then clean list access to Documents/Notices/Account & Security/
 * Appearance/Help (design handoff §"Tenant Profile", not individually mocked -- built as a
 * natural extension of Owner More's own list-row pattern).
 */
@Composable
fun TenantProfileScreen(
    onMyLeaseClick: () -> Unit,
    onDocumentsClick: () -> Unit,
    onNoticesClick: () -> Unit,
    onAccountClick: () -> Unit,
    onAppearanceClick: () -> Unit,
    viewModel: TenantProfileViewModel = hiltViewModel(),
) {
    val leaseState by viewModel.leaseUiState.collectAsState()
    val lease = (leaseState as? TenancyLeaseResult.Loaded)?.lease

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ProfileHeader(lease = lease)
        LazyColumn(contentPadding = PaddingValues(20.dp)) {
            item { ProfileRow("My lease", "Property, unit, and lease status", Icons.Filled.Home, onMyLeaseClick) }
            item { ProfileRow("Documents", "Leases and other shared files", Icons.Filled.Description, onDocumentsClick) }
            item { ProfileRow("Notices", "Announcements from management", Icons.Filled.Notifications, onNoticesClick) }
            item { Spacer(modifier = Modifier.height(16.dp)) }
            item { ProfileRow("Account & security", "Sign out, biometric app lock", Icons.Filled.Security, onAccountClick) }
            item { ProfileRow("Appearance", "Light, dark, or system", Icons.Filled.Palette, onAppearanceClick) }
            item { ProfileRow("Help", "Contact Proplyst support", Icons.AutoMirrored.Filled.HelpOutline, onAccountClick) }
            item { Spacer(modifier = Modifier.height(48.dp)) }
        }
    }
}

@Composable
private fun ProfileHeader(lease: TenancyLease?) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(ProplystTheme.colors.navy)
            .statusBarsPadding()
            .padding(top = 24.dp, start = 20.dp, end = 20.dp, bottom = 24.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = CircleShape, color = ProplystTheme.colors.primary, modifier = Modifier.size(56.dp)) {
                Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                    Text("T", style = MaterialTheme.typography.titleLarge, color = Color.White, fontWeight = FontWeight.Bold)
                }
            }
            Column(modifier = Modifier.padding(start = 14.dp)) {
                Text(lease?.propertyNickname ?: "Tenant", style = ProplystTheme.type.screenTitle.copy(fontSize = 20.sp), color = Color.White)
                if (lease?.unitLabel != null) {
                    Text(lease.unitLabel, style = ProplystTheme.type.caption, color = ProplystTheme.colors.navyTertiaryOn, modifier = Modifier.padding(top = 2.dp))
                }
            }
        }
        if (lease != null) {
            Spacer(modifier = Modifier.height(16.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                HeaderStat("Lease status", lease.leaseStatus?.replaceFirstChar { it.uppercase() } ?: "—")
                HeaderStat("Rent", lease.rentAmount?.let { "R${formatCurrency(it)}" } ?: "—")
                HeaderStat("Ends", lease.endDate ?: "—")
            }
        }
    }
}

@Composable
private fun HeaderStat(label: String, value: String) {
    Column {
        Text(label, style = ProplystTheme.type.caption, color = ProplystTheme.colors.navyTertiaryOn)
        Text(value, style = ProplystTheme.type.cardTitle.copy(fontSize = 15.sp), color = Color.White, modifier = Modifier.padding(top = 2.dp))
    }
}

@Composable
private fun ProfileRow(title: String, description: String, icon: ImageVector, onClick: () -> Unit) {
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
