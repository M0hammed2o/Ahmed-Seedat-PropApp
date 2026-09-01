package za.co.proplyst.app.ui.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import za.co.proplyst.app.data.auth.AuthRepository
import za.co.proplyst.app.data.biometric.BiometricLockPreferences
import javax.inject.Inject

/** Auth/session hardening pass (WORKLOG.md this date) -- the previously-missing sign-out entry
 * point: `AuthRepository.signOut()`/`RootAuthViewModel.signOut()` existed at every lower layer
 * already, but no screen anywhere called them (grepped, confirmed zero call sites). Deliberately
 * a plain fire-and-forget call, not a Result the screen branches on -- `signOut()` itself never
 * fails from the caller's point of view (a network revoke failure is swallowed and logged, per
 * SupabaseAuthRepository's own comment: "a failed network call here must never block sign-out"),
 * so the only UI state this needs is "is the sign-out in flight." RootNavGraph's own top-level
 * `authState` observer is what actually navigates back to sign-in once `authState` flips to
 * `Unauthenticated` -- this screen does not navigate itself. */
@HiltViewModel
class AccountViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val biometricLockPreferences: BiometricLockPreferences,
) : ViewModel() {
    private val _signingOut = MutableStateFlow(false)
    val signingOut: StateFlow<Boolean> = _signingOut.asStateFlow()

    /** The single source of truth for the toggle -- see BiometricLockPreferences' own doc
     * comment for why this reads the `@Singleton` directly rather than going through
     * BiometricGateViewModel (a different `hiltViewModel()` scope, since this screen sits in a
     * different NavHost). */
    val biometricLockEnabled: StateFlow<Boolean> = biometricLockPreferences.enabled

    fun setBiometricLockEnabled(enabled: Boolean) {
        biometricLockPreferences.setEnabled(enabled)
    }

    fun signOut() {
        if (_signingOut.value) return // Already in flight -- ignore a double-tap.
        _signingOut.value = true
        viewModelScope.launch {
            authRepository.signOut()
            // No need to reset _signingOut back to false on success: RootNavGraph's authState
            // observer navigates this screen off the back stack entirely once Unauthenticated
            // takes effect. Reset only matters for the (currently unreachable, since signOut()
            // never actually returns a failure) case of this ViewModel surviving that navigation.
        }
    }
}
