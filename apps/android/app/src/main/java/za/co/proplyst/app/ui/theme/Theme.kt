package za.co.proplyst.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf

// Proplyst Mobile Design System -- direction "1b Navy Deck" (redesign pass, replaces the old
// earth-tone PropertyVault palette). M3 dynamic colour (Material You) is deliberately NOT used --
// Proplyst's Navy Deck identity is a deliberate brand choice, and letting the user's
// wallpaper-derived system palette override it would defeat that.
//
// Every M3 role below is populated explicitly (not left to lightColorScheme()/darkColorScheme()'s
// own baseline-purple defaults) so built-in components (Button, TextField, Dialog, NavigationBar)
// match the custom-drawn ones, which read the same palette via [LocalProplystColors].

private fun buildLightScheme(): ColorScheme = lightColorScheme(
    primary = ProplystLightPalette.Primary,
    onPrimary = ProplystLightPalette.Surface,
    primaryContainer = ProplystLightPalette.BlueTint,
    onPrimaryContainer = ProplystLightPalette.PrimaryDeep,
    secondary = ProplystLightPalette.NavyText,
    onSecondary = ProplystLightPalette.Surface,
    secondaryContainer = ProplystLightPalette.Divider,
    onSecondaryContainer = ProplystLightPalette.TextPrimary,
    tertiary = ProplystLightPalette.Warning,
    onTertiary = ProplystLightPalette.Surface,
    tertiaryContainer = ProplystLightPalette.WarningBg,
    onTertiaryContainer = ProplystLightPalette.WarningDeep,
    error = ProplystLightPalette.Critical,
    onError = ProplystLightPalette.Surface,
    errorContainer = ProplystLightPalette.CriticalBg,
    onErrorContainer = ProplystLightPalette.CriticalDeep,
    background = ProplystLightPalette.Canvas,
    onBackground = ProplystLightPalette.TextPrimary,
    surface = ProplystLightPalette.Surface,
    onSurface = ProplystLightPalette.TextPrimary,
    surfaceVariant = ProplystLightPalette.InputSurface,
    onSurfaceVariant = ProplystLightPalette.TextSecondary,
    outline = ProplystLightPalette.Border,
    outlineVariant = ProplystLightPalette.Divider,
)

private fun buildDarkScheme(): ColorScheme = darkColorScheme(
    primary = ProplystDarkPalette.Primary,
    onPrimary = ProplystDarkPalette.Navy,
    primaryContainer = ProplystDarkPalette.BlueTint,
    onPrimaryContainer = ProplystDarkPalette.Primary,
    secondary = ProplystDarkPalette.NavyTertiaryOn,
    onSecondary = ProplystDarkPalette.Navy,
    secondaryContainer = ProplystDarkPalette.Divider,
    onSecondaryContainer = ProplystDarkPalette.TextPrimary,
    tertiary = ProplystDarkPalette.Warning,
    onTertiary = ProplystDarkPalette.Navy,
    tertiaryContainer = ProplystDarkPalette.WarningBg,
    onTertiaryContainer = ProplystDarkPalette.WarningDeep,
    error = ProplystDarkPalette.Critical,
    onError = ProplystDarkPalette.Navy,
    errorContainer = ProplystDarkPalette.CriticalBg,
    onErrorContainer = ProplystDarkPalette.CriticalDeep,
    background = ProplystDarkPalette.Canvas,
    onBackground = ProplystDarkPalette.TextPrimary,
    surface = ProplystDarkPalette.Surface,
    onSurface = ProplystDarkPalette.TextPrimary,
    surfaceVariant = ProplystDarkPalette.InputSurface,
    onSurfaceVariant = ProplystDarkPalette.TextSecondary,
    outline = ProplystDarkPalette.Border,
    outlineVariant = ProplystDarkPalette.Divider,
)

private val LightScheme = buildLightScheme()
private val DarkScheme = buildDarkScheme()

val LocalProplystColors = staticCompositionLocalOf { LightProplystColors }
val LocalProplystType = staticCompositionLocalOf { ProplystTypeTokensInstance }

/** Semantic design-system accessor, parallel to `MaterialTheme.colorScheme` /
 * `MaterialTheme.typography` -- `ProplystTheme.colors.navy`, `ProplystTheme.type.financialHero`. */
object ProplystTheme {
    val colors: ProplystColorTokens
        @Composable get() = LocalProplystColors.current
    val type: ProplystTypeTokens
        @Composable get() = LocalProplystType.current
}

@Composable
fun ProplystTheme(
    themeMode: ThemeMode = ThemeMode.SYSTEM,
    content: @Composable () -> Unit,
) {
    val darkTheme = when (themeMode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
    val colorScheme = if (darkTheme) DarkScheme else LightScheme
    val proplystColors = if (darkTheme) DarkProplystColors else LightProplystColors
    CompositionLocalProvider(
        LocalProplystColors provides proplystColors,
        LocalProplystType provides ProplystTypeTokensInstance,
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = ProplystTypography,
            shapes = ProplystShapes,
            content = content,
        )
    }
}
