package za.co.proplyst.app.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import za.co.proplyst.app.R

// Proplyst Mobile Design System typography -- direction "1b Navy Deck", fidelity-audit pass
// (design/New-design_handoff_proplyst_mobile/ANDROID_FIDELITY_AUDIT.md §0.1/§0.2/§8). Plus
// Jakarta Sans is now BUNDLED locally (res/font/, the official OFL static TTFs from
// github.com/tokotype/PlusJakartaSans -- never a runtime/web-font dependency), so weight 800
// renders as real ExtraBold instead of Roboto's Bold collapse the audit called out.
val ProplystFontFamily: FontFamily = FontFamily(
    Font(R.font.plus_jakarta_sans_regular, FontWeight.Normal),
    Font(R.font.plus_jakarta_sans_medium, FontWeight.Medium),
    Font(R.font.plus_jakarta_sans_semibold, FontWeight.SemiBold),
    Font(R.font.plus_jakarta_sans_bold, FontWeight.Bold),
    Font(R.font.plus_jakarta_sans_extrabold, FontWeight.ExtraBold),
)

/** The audit's §8 type table, 1:1. Every style reads [ProplystFontFamily]; screens must use these
 * tokens rather than inline `.copy(fontSize = …)` overrides (audit §0.2). */
data class ProplystTypeTokens(
    val financialHero: TextStyle,
    val screenTitle: TextStyle,
    val pageTitle: TextStyle,
    val settingsTitle: TextStyle,
    val sectionHeading: TextStyle,
    val cardTitleLarge: TextStyle,
    val wordmark: TextStyle,
    val button: TextStyle,
    val buttonSecondary: TextStyle,
    val cardTitle: TextStyle,
    val body: TextStyle,
    val caption: TextStyle,
    val captionEmphasis: TextStyle,
    val meta: TextStyle,
    val kpiValue: TextStyle,
    val chipLabel: TextStyle,
    val microLabel: TextStyle,
    // Legacy aliases kept so untouched screens keep compiling; map onto the audit table.
    val greeting: TextStyle,
    val bodySmall: TextStyle,
    val statusLabel: TextStyle,
)

private fun style(
    size: Int,
    weight: FontWeight,
    tracking: Double = 0.0,
    lineHeight: Int? = null,
) = TextStyle(
    fontFamily = ProplystFontFamily,
    fontWeight = weight,
    fontSize = size.sp,
    letterSpacing = tracking.sp,
    lineHeight = (lineHeight ?: (size * 1.3).toInt()).sp,
)

val ProplystTypeTokensInstance = ProplystTypeTokens(
    financialHero = style(44, FontWeight.ExtraBold, -1.4, lineHeight = 46),
    screenTitle = style(28, FontWeight.ExtraBold, -0.6, lineHeight = 32),
    pageTitle = style(26, FontWeight.ExtraBold, -0.5, lineHeight = 30),
    settingsTitle = style(22, FontWeight.ExtraBold, -0.4, lineHeight = 26),
    sectionHeading = style(17, FontWeight.Bold),
    cardTitleLarge = style(18, FontWeight.Bold, -0.2),
    wordmark = style(16, FontWeight.Bold, -0.2),
    button = style(16, FontWeight.Bold),
    buttonSecondary = style(15, FontWeight.SemiBold),
    cardTitle = style(15, FontWeight.SemiBold),
    body = style(14, FontWeight.Normal, lineHeight = 20),
    caption = style(13, FontWeight.Normal, lineHeight = 18),
    captionEmphasis = style(13, FontWeight.SemiBold, lineHeight = 18),
    meta = style(12, FontWeight.Normal, lineHeight = 16),
    kpiValue = style(20, FontWeight.ExtraBold, -0.5),
    chipLabel = style(11, FontWeight.Bold, lineHeight = 14),
    microLabel = style(10, FontWeight.SemiBold, 0.5, lineHeight = 13),
    greeting = style(14, FontWeight.Normal, lineHeight = 20),
    bodySmall = style(14, FontWeight.Normal, lineHeight = 20),
    statusLabel = style(11, FontWeight.Bold, 0.3, lineHeight = 14),
)

/** Material 3 role mapping for built-in components (Button, TextField, TopAppBar, ...) that read
 * `MaterialTheme.typography` directly and know nothing about [ProplystTypeTokens]. */
val ProplystTypography = Typography(
    displaySmall = ProplystTypeTokensInstance.financialHero,
    headlineMedium = ProplystTypeTokensInstance.screenTitle,
    headlineSmall = ProplystTypeTokensInstance.pageTitle,
    titleLarge = ProplystTypeTokensInstance.sectionHeading,
    titleMedium = ProplystTypeTokensInstance.cardTitle,
    bodyLarge = ProplystTypeTokensInstance.body,
    bodyMedium = ProplystTypeTokensInstance.body,
    bodySmall = ProplystTypeTokensInstance.caption,
    labelLarge = ProplystTypeTokensInstance.buttonSecondary,
    labelMedium = ProplystTypeTokensInstance.meta,
    labelSmall = ProplystTypeTokensInstance.chipLabel,
)
