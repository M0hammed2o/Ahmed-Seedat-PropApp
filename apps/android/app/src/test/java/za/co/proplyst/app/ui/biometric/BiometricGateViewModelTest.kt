package za.co.proplyst.app.ui.biometric

import android.content.Context
import androidx.lifecycle.Lifecycle
import za.co.proplyst.app.data.biometric.BiometricLockPreferences
import za.co.proplyst.app.data.biometric.LockRequestBus
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkStatic
import io.mockk.unmockkStatic
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Auth/session hardening pass (WORKLOG.md this date) -- pins down the lifecycle-driven lock
 * state machine directly (calling the `DefaultLifecycleObserver` callbacks as OS lifecycle
 * dispatch would, rather than going through a real `ProcessLifecycleOwner`, which needs a real
 * Android runtime this pure-JVM test suite doesn't have -- same reasoning TokenAuthenticatorTest
 * uses real OkHttp types but never a real network). `checkBiometricAvailability()` is a top-level
 * function (not injectable) -- mocked via `mockkStatic` on its own file's compiled Kt class. */
@OptIn(ExperimentalCoroutinesApi::class)
class BiometricGateViewModelTest {

    @Before
    fun setUp() {
        // The fidelity-audit pass added a viewModelScope collector (LockRequestBus) to init{} --
        // viewModelScope needs a Main dispatcher in pure-JVM tests.
        Dispatchers.setMain(StandardTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        unmockkStatic("za.co.proplyst.app.ui.biometric.BiometricAuthenticatorKt")
    }

    private fun viewModel(
        initialEnabled: Boolean,
        availability: BiometricAvailability = BiometricAvailability.AVAILABLE,
    ): BiometricGateViewModel {
        mockkStatic("za.co.proplyst.app.ui.biometric.BiometricAuthenticatorKt")
        every { checkBiometricAvailability(any()) } returns availability
        val preferences = mockk<BiometricLockPreferences>()
        every { preferences.enabled } returns MutableStateFlow(initialEnabled)
        val context = mockk<Context>(relaxed = true)
        val lifecycle = mockk<Lifecycle>(relaxed = true)
        return BiometricGateViewModel(preferences, context, lifecycle, LockRequestBus(), mockk(relaxed = true))
    }

    @Test
    fun `does nothing on background-then-foreground when the toggle is off`() {
        val gate = viewModel(initialEnabled = false)

        gate.onStop(mockk())
        gate.onStart(mockk())

        assertFalse(gate.locked.value)
    }

    @Test
    fun `locks on foreground after a real background cycle when the toggle is on and biometrics are available`() {
        val gate = viewModel(initialEnabled = true)

        gate.onStop(mockk())
        gate.onStart(mockk())

        assertTrue(gate.locked.value)
    }

    @Test
    fun `does NOT lock if the app never actually backgrounded (no onStop before onStart)`() {
        val gate = viewModel(initialEnabled = true)

        // onStart alone (e.g. the very first launch's own lifecycle dispatch) must never lock --
        // there is no "returning from background" to gate against yet.
        gate.onStart(mockk())

        assertFalse(gate.locked.value)
    }

    @Test
    fun `never traps the user -- skips locking if biometrics became unavailable while backgrounded`() {
        val gate = viewModel(initialEnabled = true, availability = BiometricAvailability.NOT_ENROLLED)

        gate.onStop(mockk())
        gate.onStart(mockk())

        assertFalse(
            "A user who removed their fingerprint enrollment while the app was backgrounded must never be locked out",
            gate.locked.value,
        )
    }

    @Test
    fun `unlock() clears the locked state`() {
        val gate = viewModel(initialEnabled = true)
        gate.onStop(mockk())
        gate.onStart(mockk())
        assertTrue(gate.locked.value)

        gate.unlock()

        assertFalse(gate.locked.value)
    }

    @Test
    fun `a second onStart without an intervening onStop does not re-lock after unlock()`() {
        val gate = viewModel(initialEnabled = true)
        gate.onStop(mockk())
        gate.onStart(mockk())
        gate.unlock()

        // e.g. a configuration change re-dispatching ON_START without the process ever having
        // actually left the foreground in between -- must not re-arm the lock from thin air.
        gate.onStart(mockk())

        assertFalse(gate.locked.value)
    }
}
