package com.propertyvault.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

// Static ColorScheme generated from LightColors/DarkColors -- M3 dynamic colour (Material You) is
// deliberately NOT used, per NATIVE_ANDROID_SPEC.md §5: PropertyVault's own accent is a
// deliberate brand choice (DESIGN_SYSTEM.md "Direction"), and letting the user's wallpaper-derived
// system palette override it would defeat that.
private val LightScheme = lightColorScheme(
    primary = LightColors.accent,
    onPrimary = LightColors.accentContrast,
    background = LightColors.surface,
    surface = LightColors.surfaceRaised,
    onBackground = LightColors.textPrimary,
    onSurface = LightColors.textPrimary,
    outline = LightColors.border,
    error = LightColors.danger,
)

private val DarkScheme = darkColorScheme(
    primary = DarkColors.accent,
    onPrimary = DarkColors.accentContrast,
    background = DarkColors.surface,
    surface = DarkColors.surfaceRaised,
    onBackground = DarkColors.textPrimary,
    onSurface = DarkColors.textPrimary,
    outline = DarkColors.border,
    error = DarkColors.danger,
)

@Composable
fun PropertyVaultTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkScheme else LightScheme
    MaterialTheme(
        colorScheme = colorScheme,
        typography = PropertyVaultTypography,
        shapes = PropertyVaultShapes,
        content = content,
    )
}
