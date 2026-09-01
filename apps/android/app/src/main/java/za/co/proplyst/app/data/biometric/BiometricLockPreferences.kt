package za.co.proplyst.app.data.biometric

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Biometric app-lock ON/OFF toggle (NATIVE_ANDROID_SPEC.md §12: "configurable in Settings").
 * Deliberately plain (unencrypted) SharedPreferences, not SessionManager's
 * EncryptedSharedPreferences -- this stores a UI preference, not a credential; the actual
 * session tokens SessionManager guards remain untouched by anything in this package (biometric
 * lock is a client-side-only gate, NATIVE_ANDROID_SPEC.md §12's own explicit scope -- it never
 * substitutes for or extends the JWT session's own expiry/refresh cycle).
 *
 * Exposes a live `StateFlow`, not just a plain getter, specifically so [AccountScreen]'s toggle
 * (reached through the Owner/Tenant nested NavHost, its own NavBackStackEntry-scoped
 * ViewModelStoreOwner) and [BiometricGateViewModel] (Activity-scoped, obtained once directly in
 * RootNavGraph) both observe the SAME live value despite being two independent
 * `hiltViewModel()` call sites that would otherwise resolve to two different ViewModelStoreOwners
 * -- this `@Singleton` class, not either ViewModel, is the actual single source of truth, so a
 * toggle flip takes effect immediately for the next app-background/foreground cycle rather than
 * only after an app restart.
 */
@Singleton
class BiometricLockPreferences @Inject constructor(@ApplicationContext context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val _enabled = MutableStateFlow(prefs.getBoolean(KEY_ENABLED, false))
    val enabled: StateFlow<Boolean> = _enabled.asStateFlow()

    fun setEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_ENABLED, enabled).apply()
        _enabled.value = enabled
    }

    private companion object {
        const val PREFS_NAME = "biometric_lock_prefs"
        const val KEY_ENABLED = "enabled"
    }
}
