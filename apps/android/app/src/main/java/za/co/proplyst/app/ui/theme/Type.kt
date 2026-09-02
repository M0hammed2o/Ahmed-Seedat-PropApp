package za.co.proplyst.app.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Proplyst Mobile Design System typography -- direction "1b Navy Deck". The approved handoff
// specifies Plus Jakarta Sans; that font is not bundled in this project and this pass deliberately
// does not add a brittle remote/downloaded font dependency just to match one weight family exactly
// (design/.../README.md "Android may fall back to Roboto for body" already anticipates this). Every
// style below reads its family from [ProplystFontFamily] alone, so dropping in the real Plus
// Jakarta Sans font files later (res/font/) is a one-line change here, not a per-screen hunt.
val ProplystFontFamily: FontFamily = FontFamily.Default

/** Extra semantic styles the Material 3 [Typography] role set doesn't name directly (a financial
 * hero number and a dedicated greeting style aren't M3 concepts) -- exposed via
 * `ProplystTheme.typography`, alongside `MaterialTheme.typography` for the M3 roles below. Sizes
 * mirror the handoff's "Typography" token table 1:1. */
data class ProplystTypeTokens(
    val financialHero: TextStyle,
    val screenTitle: TextStyle,
    val greeting: TextStyle,
    val sectionHeading: TextStyle,
    val cardTitle: TextStyle,
    val body: TextStyle,
    val bodySmall: TextStyle,
    val caption: TextStyle,
    val captionEmphasis: TextStyle,
    val statusLabel: TextStyle,
)

val ProplystTypeTokensInstance = ProplystTypeTokens(
    financialHero = TextStyle(
        fontFamily = ProplystFontFamily,
        fontWeight = FontWeight.ExtraBold,
        fontSize = 44.sp,
        lineHeight = 48.sp,
        letterSpacing = (-1.4).sp,
    ),
    screenTitle = TextStyle(
        fontFamily = ProplystFontFamily,
        fontWeight = FontWeight.ExtraBold,
        fontSize = 28.sp,
        lineHeight = 34.sp,
        letterSpacing = (-0.5).sp,
    ),
    greeting = TextStyle(
        fontFamily = ProplystFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    sectionHeading = TextStyle(
        fontFamily = ProplystFontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 17.sp,
        lineHeight = 22.sp,
    ),
    cardTitle = TextStyle(
        fontFamily = ProplystFontFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 17.sp,
        lineHeight = 22.sp,
    ),
    body = TextStyle(
        fontFamily = ProplystFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 22.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = ProplystFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    caption = TextStyle(
        fontFamily = ProplystFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 18.sp,
    ),
    captionEmphasis = TextStyle(
        fontFamily = ProplystFontFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        lineHeight = 18.sp,
    ),
    statusLabel = TextStyle(
        fontFamily = ProplystFontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 11.sp,
        lineHeight = 14.sp,
        letterSpacing = 0.5.sp,
    ),
)

/** Material 3 role mapping for built-in components (Button, TextField, TopAppBar, ...) that read
 * `MaterialTheme.typography` directly and know nothing about [ProplystTypeTokens]. */
val ProplystTypography = Typography(
    displaySmall = ProplystTypeTokensInstance.financialHero,
    headlineMedium = ProplystTypeTokensInstance.screenTitle,
    titleLarge = ProplystTypeTokensInstance.sectionHeading,
    titleMedium = ProplystTypeTokensInstance.cardTitle,
    bodyLarge = ProplystTypeTokensInstance.body,
    bodyMedium = ProplystTypeTokensInstance.bodySmall,
    bodySmall = ProplystTypeTokensInstance.caption,
    labelLarge = ProplystTypeTokensInstance.captionEmphasis,
    labelSmall = ProplystTypeTokensInstance.statusLabel,
)
