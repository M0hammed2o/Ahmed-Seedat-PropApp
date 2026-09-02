package za.co.proplyst.app.ui.properties

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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.ui.common.CachedDataBanner
import za.co.proplyst.app.ui.common.ErrorStateView
import za.co.proplyst.app.ui.common.LoadingView
import za.co.proplyst.app.ui.common.PropertyPhoto
import za.co.proplyst.app.ui.theme.ProplystPillShape
import za.co.proplyst.app.ui.theme.ProplystTheme

/**
 * Properties grid (Proplyst Mobile Design System redesign pass, approved Navy Deck direction) --
 * replaces the previous plain text list. Navy header with search + category filter chips, then a
 * scrolling grid of full-bleed photo cards (design handoff §"Properties"). Real functionality, not
 * a decorative facade: both search and the filter chips actually narrow
 * [PropertiesListViewModel.uiState] client-side.
 */
@Composable
fun PropertiesListScreen(
    onPropertyClick: (String) -> Unit,
    viewModel: PropertiesListViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val searchQuery by viewModel.searchQuery.collectAsState()
    val categoryFilter by viewModel.categoryFilter.collectAsState()

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        PropertiesNavyHeader(
            count = (uiState as? PropertiesListUiState.Loaded)?.properties?.size,
            query = searchQuery,
            onQueryChange = viewModel::onSearchQueryChange,
            selectedFilter = categoryFilter,
            onFilterChange = viewModel::onCategoryFilterChange,
        )
        when (val state = uiState) {
            is PropertiesListUiState.Loading -> LoadingView(modifier = Modifier.fillMaxSize())
            is PropertiesListUiState.Empty -> Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Text(state.message, style = ProplystTheme.type.body, color = ProplystTheme.colors.textSecondary)
            }
            is PropertiesListUiState.Error -> ErrorStateView(message = state.message, onRetry = viewModel::load, modifier = Modifier.fillMaxSize())
            is PropertiesListUiState.Loaded -> Column(modifier = Modifier.fillMaxSize()) {
                if (state.cachedAt != null) CachedDataBanner(relativeTime = state.cachedAt)
                LazyColumn(
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    items(state.properties, key = { it.id }) { property ->
                        PropertyCard(property = property, onClick = { onPropertyClick(property.id) })
                    }
                    item { Spacer(modifier = Modifier.height(80.dp)) }
                }
            }
        }
    }
}

@Composable
private fun PropertiesNavyHeader(
    count: Int?,
    query: String,
    onQueryChange: (String) -> Unit,
    selectedFilter: PropertyCategoryFilter,
    onFilterChange: (PropertyCategoryFilter) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(ProplystTheme.colors.navy)
            .statusBarsPadding()
            .padding(top = 20.dp, start = 20.dp, end = 20.dp, bottom = 18.dp),
    ) {
        Text("Properties", style = ProplystTheme.type.screenTitle, color = Color.White)
        if (count != null) {
            Text(
                "$count ${if (count == 1) "property" else "properties"}",
                style = ProplystTheme.type.caption,
                color = ProplystTheme.colors.navySecondaryOn,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        Spacer(modifier = Modifier.height(14.dp))
        OutlinedTextField(
            value = query,
            onValueChange = onQueryChange,
            placeholder = { Text("Search properties", color = ProplystTheme.colors.navyTertiaryOn) },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null, tint = ProplystTheme.colors.navyTertiaryOn) },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White,
                focusedBorderColor = Color.White.copy(alpha = 0.24f),
                unfocusedBorderColor = Color.White.copy(alpha = 0.12f),
                focusedContainerColor = Color.White.copy(alpha = 0.08f),
                unfocusedContainerColor = Color.White.copy(alpha = 0.08f),
                cursorColor = Color.White,
            ),
            modifier = Modifier.fillMaxWidth().height(56.dp),
        )
        Spacer(modifier = Modifier.height(12.dp))
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(PropertyCategoryFilter.entries.toList()) { filter ->
                FilterChip(filter = filter, selected = filter == selectedFilter, onClick = { onFilterChange(filter) })
            }
        }
    }
}

@Composable
private fun FilterChip(filter: PropertyCategoryFilter, selected: Boolean, onClick: () -> Unit) {
    val label = when (filter) {
        PropertyCategoryFilter.ALL -> "All"
        PropertyCategoryFilter.RESIDENTIAL -> "Residential"
        PropertyCategoryFilter.COMMERCIAL -> "Commercial"
        PropertyCategoryFilter.LAND -> "Land"
    }
    Surface(
        shape = ProplystPillShape,
        color = if (selected) Color.White else Color.Transparent,
        border = if (selected) null else androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(alpha = 0.2f)),
        modifier = Modifier
            .height(32.dp)
            .clickable(onClick = onClick),
    ) {
        Box(
            modifier = Modifier.padding(horizontal = 14.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                label,
                style = ProplystTheme.type.captionEmphasis,
                color = if (selected) ProplystTheme.colors.navy else ProplystTheme.colors.navyTertiaryOn,
            )
        }
    }
}

@Composable
private fun PropertyCard(property: Property, onClick: () -> Unit) {
    val statusLabel = if (property.status == "active") "Active" else "Archived"
    val statusColor = if (property.status == "active") ProplystTheme.colors.success else ProplystTheme.colors.textTertiary
    val statusBg = if (property.status == "active") ProplystTheme.colors.successBg else ProplystTheme.colors.divider
    val occupancyFraction = if (property.unitCount > 0) property.occupiedUnitCount.toFloat() / property.unitCount else 0f

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(230.dp)
            .clip(RoundedCornerShape(20.dp))
            .clickable(onClick = onClick),
    ) {
        PropertyPhoto(imageUrl = property.coverPhotoUrl, contentDescription = property.nickname, modifier = Modifier.fillMaxSize())
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0f to Color.Black.copy(alpha = 0.15f),
                        0.35f to Color.Black.copy(alpha = 0.05f),
                        1f to ProplystTheme.colors.navy.copy(alpha = 0.92f),
                    ),
                ),
        )
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Surface(color = Color.White.copy(alpha = 0.18f), shape = ProplystPillShape) {
                Text(
                    propertyTypeLabel(property.propertyType),
                    style = ProplystTheme.type.statusLabel,
                    color = Color.White,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                )
            }
            Surface(color = statusBg, shape = ProplystPillShape) {
                Text(
                    statusLabel,
                    style = ProplystTheme.type.statusLabel,
                    color = statusColor,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                )
            }
        }
        Column(modifier = Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(16.dp)) {
            Text(
                property.nickname,
                style = ProplystTheme.type.cardTitle.copy(fontSize = 18.sp),
                color = Color.White,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                property.fullAddress,
                style = ProplystTheme.type.caption,
                color = ProplystTheme.colors.navyTertiaryOn,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )
            Spacer(modifier = Modifier.height(10.dp))
            if (property.unitCount > 0) {
                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    StatColumn("UNITS", "${property.unitCount}")
                    StatColumn("OCCUPIED", "${property.occupiedUnitCount}/${property.unitCount}")
                    StatColumn("LET", "${(occupancyFraction * 100).toInt()}%")
                }
                Spacer(modifier = Modifier.height(8.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(4.dp)
                        .clip(RoundedCornerShape(50))
                        .background(Color.White.copy(alpha = 0.14f)),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(occupancyFraction.coerceIn(0f, 1f))
                            .height(4.dp)
                            .background(ProplystTheme.colors.primaryLightOnNavy, RoundedCornerShape(50)),
                    )
                }
            }
        }
    }
}

@Composable
private fun StatColumn(label: String, value: String) {
    Column {
        Text(label, style = ProplystTheme.type.statusLabel, color = ProplystTheme.colors.navySecondaryOn)
        Text(value, style = ProplystTheme.type.cardTitle.copy(fontSize = 15.sp), color = Color.White, modifier = Modifier.padding(top = 2.dp))
    }
}


private fun propertyTypeLabel(propertyType: String): String = when (propertyType) {
    "house", "apartment", "apartment_building", "townhouse", "student_accommodation" -> "Residential"
    "commercial", "office", "industrial", "mixed_use" -> "Commercial"
    "retail" -> "Retail"
    "vacant_land" -> "Land"
    else -> "Property"
}
