package za.co.proplyst.app.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import za.co.proplyst.app.ui.theme.ProplystFontFamily
import za.co.proplyst.app.ui.theme.ProplystLightPalette
import za.co.proplyst.app.ui.theme.ProplystPillShape

/** One primary destination in the floating bottom nav. */
data class FloatingNavItem(
    val route: String,
    val label: String,
    val icon: ImageVector,
)

/**
 * Proplyst Mobile Design System -- the ONE intentional departure from the approved Navy Deck
 * concept (final navigation override, design handoff): a floating WHITE pill bar rather than a
 * dark navy floating container, so the nav reads as a light, premium object sitting on top of the
 * Navy Deck content rather than blending into it. Per spec §22, this stays white in BOTH light and
 * dark mode -- deliberately NOT `MaterialTheme.colorScheme.surface` (that flips to a dark navy
 * surface in dark mode, which would silently violate the spec's own explicit "floating bottom
 * navigation remains white" instruction). Colors below are pinned to [ProplystLightPalette]
 * regardless of the active theme for exactly that reason.
 *
 * Insets itself from both side edges and the gesture/navigation-bar area (never touches any screen
 * edge), and is a fixed 4-item Row, never a scrollable one -- no scroll indicator to suppress.
 */
@Composable
fun FloatingBottomNav(
    items: List<FloatingNavItem>,
    currentRoute: String?,
    onItemClick: (FloatingNavItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .navigationBarsPadding()
            .padding(horizontal = 20.dp, vertical = 10.dp),
    ) {
        Surface(
            color = ProplystLightPalette.Surface,
            shape = ProplystPillShape,
            shadowElevation = 12.dp,
            tonalElevation = 0.dp,
            modifier = Modifier
                .fillMaxWidth()
                .height(64.dp),
        ) {
            Row(
                horizontalArrangement = Arrangement.SpaceEvenly,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 6.dp),
            ) {
                items.forEach { item ->
                    FloatingNavEntry(
                        item = item,
                        selected = currentRoute == item.route,
                        onClick = { onItemClick(item) },
                    )
                }
            }
        }
    }
}

@Composable
private fun RowScope.FloatingNavEntry(
    item: FloatingNavItem,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val activeColor = ProplystLightPalette.Primary
    val inactiveColor = ProplystLightPalette.TextTertiary
    val interactionSource = remember { MutableInteractionSource() }
    Column(
        modifier = Modifier
            .weight(1f)
            .fillMaxHeight()
            .selectable(
                selected = selected,
                onClick = onClick,
                role = Role.Tab,
                interactionSource = interactionSource,
                indication = null,
            ),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .size(width = 52.dp, height = 30.dp)
                .background(
                    color = if (selected) ProplystLightPalette.BlueTint else Color.Transparent,
                    shape = ProplystPillShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = item.icon,
                contentDescription = item.label,
                tint = if (selected) activeColor else inactiveColor,
                modifier = Modifier.size(22.dp),
            )
        }
        Text(
            text = item.label,
            // Fidelity audit §11: 11/600, no tracking -- deliberately NOT the chipLabel token
            // (11/700 + tracking), which is for chips, not nav labels.
            style = TextStyle(fontFamily = ProplystFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 11.sp),
            color = if (selected) activeColor else inactiveColor,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}
