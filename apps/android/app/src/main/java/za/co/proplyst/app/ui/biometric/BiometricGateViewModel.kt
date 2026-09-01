package za.co.proplyst.app.ui.biometric

import android.annotation.SuppressLint
import android.content.Context
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import za.co.proplyst.app.data.biometric.BiometricLockPreferences
import javax.inject.Inject

/**
 * NATIVE_ANDROID_SPEC.md §12: "fingerprint/face unlock gate on app foreground-from-background,
 * configurable in Settings." The injected [Lifecycle] is the PROCESS (whole-app) lifecycle, not
 * an individual Activity's -- provided by [za.co.proplyst.app.di.LifecycleModule] as
 * `ProcessLifecycleOwner.get().lifecycle`, not fetched here directly, specifically so a unit test
 * can supply a mocked `Lifecycle` instead (`ProcessLifecycleOwner.get()` needs a real Android
 * process/Looper this project's pure-JVM unit tests don't have -- confirmed live this pass: a
 * direct call inside this ViewModel's own `init{}` threw at test-construction time). It fires
 * ON_STOP once when the last Activity stops (not on every screen rotation/Activity recreation the
 * way an Activity-level lifecycle would), matching "foreground-from-background" exactly rather
 * than firing on every navigation.
 *
 * Scoped the same way RootAuthViewModel is -- obtained via `hiltViewModel()` directly inside
 * RootNavGraph (not inside a nested NavHost's own `composable{}` route), so it survives for the
 * whole Activity lifetime, not per-screen. The ON/OFF toggle itself is read from
 * [BiometricLockPreferences] directly (a `@Singleton`, not this ViewModel's own state) -- see
 * that class's own doc comment for why: [za.co.proplyst.app.ui.account.AccountScreen] is nested
 * inside a DIFFERENT NavHost and would otherwise resolve `hiltViewModel()` to a second, out-of-
 * sync instance of this ViewModel.
 */
// StaticFieldLeak is a real Android Lint check, not silenced blindly here: it's flagging
// `processLifecycle` because `Lifecycle` is a generic type lint can't trace through
// LifecycleModule's own @Provides binding to see it is ALWAYS `ProcessLifecycleOwner.get()
// .lifecycle` at runtime -- a process-wide singleton, never an Activity's own lifecycle, so
// holding a reference to it for this ViewModel's own lifetime (itself Activity-scoped, strictly
// shorter than the process) cannot leak an Activity. `context` is `@ApplicationContext`, which
// lint already recognizes as safe and does not flag.
@SuppressLint("StaticFieldLeak")
@HiltViewModel
class BiometricGateViewModel @Inject constructor(
    private val preferences: BiometricLockPreferences,
    @ApplicationContext private val context: Context,
    private val processLifecycle: Lifecycle,
) : ViewModel(), DefaultLifecycleObserver {

    val lockEnabled: StateFlow<Boolean> = preferences.enabled

    private val _locked = MutableStateFlow(false)
    val locked: StateFlow<Boolean> = _locked.asStateFlow()

    private var pendingLock = false

    init {
        processLifecycle.addObserver(this)
    }

    override fun onCleared() {
        processLifecycle.removeObserver(this)
    }

    override fun onStop(owner: LifecycleOwner) {
        if (lockEnabled.value) pendingLock = true
    }

    override fun onStart(owner: LifecycleOwner) {
        // Re-checked live, not cached from when the toggle was turned on -- hardware/enrollment
        // can change while the app was backgrounded (e.g. the user removed their fingerprint in
        // system Settings). Never trap the user behind a gate that can no longer be passed: skip
        // locking this time rather than requiring biometrics that no longer exist. The toggle
        // itself is left on, since availability can just as easily come back (e.g. flight mode
        // toggled, or the device was simply still booting when this check ran).
        if (pendingLock && lockEnabled.value && checkBiometricAvailability(context) == BiometricAvailability.AVAILABLE) {
            _locked.value = true
        }
        pendingLock = false
    }

    fun unlock() {
        _locked.value = false
    }
}
