package za.co.proplyst.app.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import za.co.proplyst.app.ui.theme.ProplystLightPalette

/**
 * Navy-header glow (fidelity audit §0.4): a 340 dp circle (`rgba(27,107,242,.40) → 0`) whose
 * centre sits at the header's top-right corner offset (−100 dp x, −140 dp y) -- computed from the
 * DRAWN size in dp, replacing the previous raw-px `radialGradient(Offset(900f,−100f))` that
 * drifted with density/width. `login = true` uses the login variant (360 dp, alpha .35).
 *
 * Draw order matters: apply AFTER the solid navy `background(...)` so the glow paints on top of
 * the navy, and BEFORE padding so it anchors to the header's true top-right corner.
 */
@Composable
fun Modifier.navyHeaderGlow(login: Boolean = false): Modifier {
    val radiusDp = if (login) 180.dp else 170.dp
    val alpha = if (login) 0.35f else 0.40f
    val glowColor = ProplystLightPalette.Primary
    return drawBehind {
        val radius = radiusDp.toPx()
        val center = Offset(x = size.width - 100.dp.toPx(), y = -140.dp.toPx())
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(glowColor.copy(alpha = alpha), Color.Transparent),
                center = center,
                radius = radius,
            ),
            radius = radius,
            center = center,
        )
    }
}
