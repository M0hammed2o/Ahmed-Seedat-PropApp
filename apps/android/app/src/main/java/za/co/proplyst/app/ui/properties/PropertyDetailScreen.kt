package za.co.proplyst.app.ui.properties

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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Apartment
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.People
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.ui.common.EmptyStateView
import za.co.proplyst.app.ui.common.LoadingView
import za.co.proplyst.app.ui.common.PropertyPhoto
import za.co.proplyst.app.ui.theme.ProplystPillShape
import za.co.proplyst.app.ui.theme.ProplystTheme

/**
 * Property detail (Proplyst Mobile Design System redesign pass) -- large hero photo, real
 * unit/occupancy summary, then contextual links into Units/Tenants/Maintenance/Documents (never
 * their own bottom-nav tabs -- design handoff §"Property Detail" is not individually mocked, so
 * this is deliberately built as a natural extension of Properties/Owner Home's own visual
 * language: navy surfaces, the same card/typography/spacing tokens, PropertyPhoto's shared
 * fallback). Complex editing stays web-first, matching every other detail screen in this app.
 */
@Composable
fun PropertyDetailScreen(
    onBack: () -> Unit,
    onViewUnits: () -> Unit,
    onViewTenants: () -> Unit,
    onViewMaintenance: () -> Unit,
    viewModel: PropertyDetailViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        when (val state = uiState) {
            is PropertyDetailUiState.Loading -> LoadingView(modifier = Modifier.fillMaxSize())
            is PropertyDetailUiState.NotFound -> EmptyStateView(title = "Property not found", modifier = Modifier.fillMaxSize())
            is PropertyDetailUiState.Loaded -> LazyColumn(modifier = Modifier.fillMaxSize()) {
                item { HeroImage(property = state.property) }
                item {
                    Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) {
                        SummaryRow(property = state.property)
                        Spacer(modifier = Modifier.height(20.dp))
                        Text("Manage", style = ProplystTheme.type.sectionHeading)
                        Spacer(modifier = Modifier.height(10.dp))
                    }
                }
                items(contextualLinks(onViewUnits, onViewTenants, onViewMaintenance)) { link ->
                    ContextualLinkRow(link = link, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
                }
                item { Spacer(modifier = Modifier.height(24.dp)) }
            }
        }
        Surface(
            shape = CircleShape,
            color = Color.Black.copy(alpha = 0.28f),
            modifier = Modifier.statusBarsPadding().padding(top = 16.dp, start = 16.dp).size(40.dp),
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Color.White)
            }
        }
    }
}

@Composable
private fun HeroImage(property: Property) {
    Box(modifier = Modifier.fillMaxWidth().height(280.dp)) {
        PropertyPhoto(imageUrl = property.coverPhotoUrl, contentDescription = property.nickname, modifier = Modifier.fillMaxSize())
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0f to Color.Transparent,
                        0.55f to Color.Transparent,
                        1f to ProplystTheme.colors.navy.copy(alpha = 0.9f),
                    ),
                ),
        )
        Column(modifier = Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(20.dp)) {
            Text(property.nickname, style = ProplystTheme.type.screenTitle, color = Color.White, fontWeight = FontWeight.Bold)
            Text(property.fullAddress, style = ProplystTheme.type.body, color = ProplystTheme.colors.navyTertiaryOn, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
private fun SummaryRow(property: Property) {
    val occupancyPct = if (property.unitCount > 0) (property.occupiedUnitCount * 100 / property.unitCount) else 0
    Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(16.dp), shadowElevation = 1.dp) {
        Row(modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp)) {
            SummaryStat("Units", "${property.unitCount}", Modifier.weight(1f))
            SummaryStat("Occupied", "${property.occupiedUnitCount}", Modifier.weight(1f))
            SummaryStat("Let", "$occupancyPct%", Modifier.weight(1f))
            SummaryStat("Status", if (property.status == "active") "Active" else "Archived", Modifier.weight(1f))
        }
    }
}

@Composable
private fun SummaryStat(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
        Text(label, style = ProplystTheme.type.caption, color = ProplystTheme.colors.textSecondary, modifier = Modifier.padding(top = 2.dp))
    }
}

private data class ContextualLink(val label: String, val description: String, val icon: ImageVector, val onClick: () -> Unit)

private fun contextualLinks(
    onViewUnits: () -> Unit,
    onViewTenants: () -> Unit,
    onViewMaintenance: () -> Unit,
): List<ContextualLink> = listOf(
    ContextualLink("Units", "Unit list, occupancy, and leases", Icons.Filled.Apartment, onViewUnits),
    ContextualLink("Tenants", "Everyone renting at this property", Icons.Filled.People, onViewTenants),
    ContextualLink("Maintenance", "Open and completed requests", Icons.Filled.Build, onViewMaintenance),
)

@Composable
private fun ContextualLinkRow(link: ContextualLink, modifier: Modifier = Modifier) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(14.dp),
        shadowElevation = 1.dp,
        modifier = modifier.fillMaxWidth().clickable(onClick = link.onClick),
    ) {
        Row(modifier = Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(ProplystTheme.colors.blueTint),
                contentAlignment = Alignment.Center,
            ) {
                Icon(link.icon, contentDescription = null, tint = ProplystTheme.colors.primary, modifier = Modifier.size(18.dp))
            }
            Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
                Text(link.label, style = ProplystTheme.type.cardTitle.copy(fontSize = 15.sp))
                Text(link.description, style = ProplystTheme.type.caption, color = ProplystTheme.colors.textSecondary)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = ProplystTheme.colors.textTertiary)
        }
    }
}
