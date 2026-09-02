package za.co.proplyst.app.ui.more

import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import za.co.proplyst.app.data.appearance.AppearancePreferences
import za.co.proplyst.app.ui.theme.ThemeMode
import javax.inject.Inject

@HiltViewModel
class AppearanceViewModel @Inject constructor(
    private val preferences: AppearancePreferences,
) : ViewModel() {
    val themeMode = preferences.themeMode

    fun setThemeMode(mode: ThemeMode) = preferences.setThemeMode(mode)
}
