package za.co.proplyst.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

// Proplyst Mobile Design System radii -- direction "1b Navy Deck". Mirrors the handoff's "Shape &
// spacing" token table: inputs/buttons 14, cards 16-18, hero/photo cards 20, sheets 28 (top
// corners), pills 999.
//
// BUGFIX (this pass): the previous `extraLarge = RoundedCornerShape(999.dp)` was a real defect,
// not a cosmetic choice -- Material 3's AlertDialog/DatePickerDialog use `shapes.extraLarge` as
// their container shape by default, so every dialog in the app was being clipped into a near-circle
// (observed and mis-attributed to the emulator's software renderer during the prior pass's smoke
// test; the actual cause was this 999dp value). `extraLarge` now holds the spec's real 28dp sheet
// radius; [ProplystPillShape] below is the dedicated pill shape for buttons/chips/nav that
// genuinely want one.
val ProplystShapes = Shapes(
    extraSmall = RoundedCornerShape(10.dp),
    small = RoundedCornerShape(14.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

/** Full pill/capsule shape (radius 999) -- used explicitly by the floating bottom navigation,
 * status chips, and any control the design calls a "pill," never as an M3 [Shapes] role (see
 * bugfix note above for why that broke dialogs). */
val ProplystPillShape = RoundedCornerShape(percent = 50)
