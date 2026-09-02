package za.co.proplyst.app.ui.theme

import androidx.compose.ui.graphics.Color

// Proplyst Mobile Design System -- direction "1b Navy Deck" (approved 2026-09-02). Values are
// hand-transcribed from the design handoff at
// design/Proplyst mobile app design/design_handoff_proplyst_mobile/README.md ("Design tokens"
// section) -- the single source of truth for this palette until a shared cross-platform token
// export exists. Supersedes the old earth-tone PropertyVault palette entirely.

/** Light-mode raw palette. */
object ProplystLightPalette {
    val Primary = Color(0xFF1B6BF2)
    val PrimaryDeep = Color(0xFF0B3FA8)
    val PrimaryLightOnNavy = Color(0xFF5EA2FF)
    val BlueTint = Color(0xFFE8F0FE)

    val Navy = Color(0xFF0B1220)
    val NavyText = Color(0xFF0F1B2D)
    val NavySecondaryOn = Color(0xFF8FA3C2)
    val NavyTertiaryOn = Color(0xFFB7C6E0)
    val OutstandingOnNavy = Color(0xFFFDBA74)

    val Canvas = Color(0xFFF3F5F9)
    val Surface = Color(0xFFFFFFFF)
    val InputSurface = Color(0xFFF6F8FB)
    val Border = Color(0xFFE5E9F0)
    val Divider = Color(0xFFEEF1F5)
    val TextPrimary = Color(0xFF0F1B2D)
    val TextSecondary = Color(0xFF5B6B7F)
    val TextTertiary = Color(0xFF98A2B3)

    val Success = Color(0xFF16A34A)
    val SuccessBg = Color(0xFFDCFCE7)
    val SuccessText = Color(0xFF15803D)
    val Warning = Color(0xFFD97706)
    val WarningDeep = Color(0xFFB45309)
    val WarningBg = Color(0xFFFEF3C7)
    val Critical = Color(0xFFDC2626)
    val CriticalDeep = Color(0xFFB91C1C)
    val CriticalBg = Color(0xFFFEE2E2)
    val CriticalBgAlt = Color(0xFFFEF2F2)
    val CriticalBorder = Color(0xFFFECACA)
    val Info = Color(0xFF0284C7)
    val NetworkBg = Color(0xFFFFF7ED)
    val NetworkBorder = Color(0xFFFED7AA)
    val NetworkText = Color(0xFF9A3412)
}

/** Dark mode is "Navy Deck everywhere," not an inversion of light mode: the same navy the light
 * theme uses only for headers becomes the canvas, cards sit one step lighter than the canvas for
 * hierarchy, and status hues are lifted for contrast against a dark ground while staying
 * recognizably the same semantic colours. */
object ProplystDarkPalette {
    val Primary = Color(0xFF5EA2FF)
    val PrimaryDeep = Color(0xFF1B6BF2)
    val PrimaryLightOnNavy = Color(0xFF5EA2FF)
    val BlueTint = Color(0xFF16273F)

    val Navy = Color(0xFF08111F)
    val NavyText = Color(0xFFF3F6FC)
    val NavySecondaryOn = Color(0xFF8FA3C2)
    val NavyTertiaryOn = Color(0xFFB7C6E0)
    val OutstandingOnNavy = Color(0xFFFDBA74)

    val Canvas = Color(0xFF0B1220)
    val Surface = Color(0xFF121B2E)
    val InputSurface = Color(0xFF17213A)
    val Border = Color(0xFF263252)
    val Divider = Color(0xFF1E2A45)
    val TextPrimary = Color(0xFFF3F6FC)
    val TextSecondary = Color(0xFFAAB9D1)
    val TextTertiary = Color(0xFF7C8CAB)

    val Success = Color(0xFF4ADE80)
    val SuccessBg = Color(0xFF122A1C)
    val SuccessText = Color(0xFF86EFAC)
    val Warning = Color(0xFFFBBF24)
    val WarningDeep = Color(0xFFFCD34D)
    val WarningBg = Color(0xFF35270A)
    val Critical = Color(0xFFF87171)
    val CriticalDeep = Color(0xFFFCA5A5)
    val CriticalBg = Color(0xFF35141A)
    val CriticalBgAlt = Color(0xFF2E1216)
    val CriticalBorder = Color(0xFF5C2430)
    val Info = Color(0xFF38BDF8)
    val NetworkBg = Color(0xFF2E2110)
    val NetworkBorder = Color(0xFF5C4420)
    val NetworkText = Color(0xFFFDBA74)
}

/** Semantic token set consumed by custom Proplyst composables (hero cards, KPI strips, property
 * cards, status chips) that need colours beyond Material 3's built-in ColorScheme roles. Exposed
 * via [LocalProplystColors] / `ProplystTheme.colors`, mirroring how `MaterialTheme.colorScheme`
 * itself is consumed -- the M3 ColorScheme in [Theme.kt] is populated from the SAME palette object
 * so built-in components (Button, TextField, NavigationBar) and custom ones never disagree. */
data class ProplystColorTokens(
    val primary: Color,
    val primaryDeep: Color,
    val primaryLightOnNavy: Color,
    val blueTint: Color,
    val navy: Color,
    val navyText: Color,
    val navySecondaryOn: Color,
    val navyTertiaryOn: Color,
    val outstandingOnNavy: Color,
    val background: Color,
    val surface: Color,
    val inputSurface: Color,
    val border: Color,
    val divider: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textTertiary: Color,
    val success: Color,
    val successBg: Color,
    val successText: Color,
    val warning: Color,
    val warningDeep: Color,
    val warningBg: Color,
    val critical: Color,
    val criticalDeep: Color,
    val criticalBg: Color,
    val criticalBgAlt: Color,
    val criticalBorder: Color,
    val info: Color,
    val networkBg: Color,
    val networkBorder: Color,
    val networkText: Color,
    val isDark: Boolean,
)

val LightProplystColors = ProplystColorTokens(
    primary = ProplystLightPalette.Primary,
    primaryDeep = ProplystLightPalette.PrimaryDeep,
    primaryLightOnNavy = ProplystLightPalette.PrimaryLightOnNavy,
    blueTint = ProplystLightPalette.BlueTint,
    navy = ProplystLightPalette.Navy,
    navyText = ProplystLightPalette.NavyText,
    navySecondaryOn = ProplystLightPalette.NavySecondaryOn,
    navyTertiaryOn = ProplystLightPalette.NavyTertiaryOn,
    outstandingOnNavy = ProplystLightPalette.OutstandingOnNavy,
    background = ProplystLightPalette.Canvas,
    surface = ProplystLightPalette.Surface,
    inputSurface = ProplystLightPalette.InputSurface,
    border = ProplystLightPalette.Border,
    divider = ProplystLightPalette.Divider,
    textPrimary = ProplystLightPalette.TextPrimary,
    textSecondary = ProplystLightPalette.TextSecondary,
    textTertiary = ProplystLightPalette.TextTertiary,
    success = ProplystLightPalette.Success,
    successBg = ProplystLightPalette.SuccessBg,
    successText = ProplystLightPalette.SuccessText,
    warning = ProplystLightPalette.Warning,
    warningDeep = ProplystLightPalette.WarningDeep,
    warningBg = ProplystLightPalette.WarningBg,
    critical = ProplystLightPalette.Critical,
    criticalDeep = ProplystLightPalette.CriticalDeep,
    criticalBg = ProplystLightPalette.CriticalBg,
    criticalBgAlt = ProplystLightPalette.CriticalBgAlt,
    criticalBorder = ProplystLightPalette.CriticalBorder,
    info = ProplystLightPalette.Info,
    networkBg = ProplystLightPalette.NetworkBg,
    networkBorder = ProplystLightPalette.NetworkBorder,
    networkText = ProplystLightPalette.NetworkText,
    isDark = false,
)

val DarkProplystColors = ProplystColorTokens(
    primary = ProplystDarkPalette.Primary,
    primaryDeep = ProplystDarkPalette.PrimaryDeep,
    primaryLightOnNavy = ProplystDarkPalette.PrimaryLightOnNavy,
    blueTint = ProplystDarkPalette.BlueTint,
    navy = ProplystDarkPalette.Navy,
    navyText = ProplystDarkPalette.NavyText,
    navySecondaryOn = ProplystDarkPalette.NavySecondaryOn,
    navyTertiaryOn = ProplystDarkPalette.NavyTertiaryOn,
    outstandingOnNavy = ProplystDarkPalette.OutstandingOnNavy,
    background = ProplystDarkPalette.Canvas,
    surface = ProplystDarkPalette.Surface,
    inputSurface = ProplystDarkPalette.InputSurface,
    border = ProplystDarkPalette.Border,
    divider = ProplystDarkPalette.Divider,
    textPrimary = ProplystDarkPalette.TextPrimary,
    textSecondary = ProplystDarkPalette.TextSecondary,
    textTertiary = ProplystDarkPalette.TextTertiary,
    success = ProplystDarkPalette.Success,
    successBg = ProplystDarkPalette.SuccessBg,
    successText = ProplystDarkPalette.SuccessText,
    warning = ProplystDarkPalette.Warning,
    warningDeep = ProplystDarkPalette.WarningDeep,
    warningBg = ProplystDarkPalette.WarningBg,
    critical = ProplystDarkPalette.Critical,
    criticalDeep = ProplystDarkPalette.CriticalDeep,
    criticalBg = ProplystDarkPalette.CriticalBg,
    criticalBgAlt = ProplystDarkPalette.CriticalBgAlt,
    criticalBorder = ProplystDarkPalette.CriticalBorder,
    info = ProplystDarkPalette.Info,
    networkBg = ProplystDarkPalette.NetworkBg,
    networkBorder = ProplystDarkPalette.NetworkBorder,
    networkText = ProplystDarkPalette.NetworkText,
    isDark = true,
)
