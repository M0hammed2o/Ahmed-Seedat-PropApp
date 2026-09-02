package za.co.proplyst.app.data.appearance

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import za.co.proplyst.app.ui.theme.ThemeMode
import javax.inject.Inject
import javax.inject.Singleton

/**
 * System/Light/Dark appearance preference (Proplyst Mobile Design System redesign pass). Same
 * plain-SharedPreferences-plus-live-StateFlow shape as [za.co.proplyst.app.data.biometric
 * .BiometricLockPreferences] -- a UI preference, not a credential, so no encryption is needed, and
 * a live StateFlow lets [za.co.proplyst.app.MainActivity]'s composition and the Appearance screen's
 * own ViewModel (two independent `hiltViewModel()`/injection sites) observe the same current value
 * without an app restart.
 */
@Singleton
class AppearancePreferences @Inject constructor(@ApplicationContext context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val _themeMode = MutableStateFlow(readStoredMode())
    val themeMode: StateFlow<ThemeMode> = _themeMode.asStateFlow()

    fun setThemeMode(mode: ThemeMode) {
        prefs.edit().putString(KEY_THEME_MODE, mode.name).apply()
        _themeMode.value = mode
    }

    private fun readStoredMode(): ThemeMode {
        val stored = prefs.getString(KEY_THEME_MODE, null) ?: return ThemeMode.SYSTEM
        return runCatching { ThemeMode.valueOf(stored) }.getOrDefault(ThemeMode.SYSTEM)
    }

    private companion object {
        const val PREFS_NAME = "appearance_prefs"
        const val KEY_THEME_MODE = "theme_mode"
    }
}
