package za.co.proplyst.app.ui.account

import za.co.proplyst.app.data.auth.AuthRepository
import za.co.proplyst.app.data.auth.SessionManager
import za.co.proplyst.app.data.biometric.BiometricLockPreferences
import za.co.proplyst.app.data.biometric.LockRequestBus
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Auth/session hardening pass (WORKLOG.md this date) -- AccountViewModel is the previously-
 * missing sign-out entry point; these pin down (1) the call actually reaches AuthRepository,
 * (2) `signingOut` reflects the in-flight state so the screen can show a spinner and hide the
 * button, (3) a double-tap while already in flight is a no-op, not a second sign-out call, and
 * (4) the biometric-lock toggle delegates to the shared `@Singleton` preferences object (see
 * BiometricLockPreferences' own doc comment for why it, not this ViewModel, is the source of
 * truth). */
@OptIn(ExperimentalCoroutinesApi::class)
class AccountViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun mockBiometricPreferences(initialEnabled: Boolean = false): BiometricLockPreferences {
        val preferences = mockk<BiometricLockPreferences>(relaxed = true)
        every { preferences.enabled } returns MutableStateFlow(initialEnabled)
        return preferences
    }

    @Test
    fun `signOut calls through to the repository`() = runTest {
        val authRepository = mockk<AuthRepository>()
        coEvery { authRepository.signOut() } returns Unit
        val viewModel = AccountViewModel(authRepository, mockBiometricPreferences(), LockRequestBus(), mockk<SessionManager>(relaxed = true))

        viewModel.signOut()
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { authRepository.signOut() }
    }

    @Test
    fun `signingOut is true while the call is in flight, and stays true once it completes`() = runTest {
        val authRepository = mockk<AuthRepository>()
        val gate = CompletableDeferred<Unit>()
        coEvery { authRepository.signOut() } coAnswers { gate.await() }
        val viewModel = AccountViewModel(authRepository, mockBiometricPreferences(), LockRequestBus(), mockk<SessionManager>(relaxed = true))

        assertEquals(false, viewModel.signingOut.value)
        viewModel.signOut()
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue("signingOut should be true while the suspend call is still pending", viewModel.signingOut.value)

        gate.complete(Unit)
        dispatcher.scheduler.advanceUntilIdle()

        // Deliberately does NOT reset to false on success -- RootNavGraph's authState observer
        // navigates this screen off the back stack once Unauthenticated takes effect (see the
        // ViewModel's own doc comment); staying true simply keeps the spinner showing through
        // that navigation rather than flashing the button back for one frame.
        assertTrue(viewModel.signingOut.value)
    }

    @Test
    fun `a second signOut call while one is already in flight is ignored`() = runTest {
        val authRepository = mockk<AuthRepository>()
        val gate = CompletableDeferred<Unit>()
        coEvery { authRepository.signOut() } coAnswers { gate.await() }
        val viewModel = AccountViewModel(authRepository, mockBiometricPreferences(), LockRequestBus(), mockk<SessionManager>(relaxed = true))

        viewModel.signOut()
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.signOut() // double-tap while the first call is still pending
        dispatcher.scheduler.advanceUntilIdle()

        gate.complete(Unit)
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { authRepository.signOut() }
    }

    @Test
    fun `biometricLockEnabled reflects the preferences object, and toggling delegates to it`() {
        val authRepository = mockk<AuthRepository>(relaxed = true)
        val preferences = mockBiometricPreferences(initialEnabled = true)
        val viewModel = AccountViewModel(authRepository, preferences, LockRequestBus(), mockk<SessionManager>(relaxed = true))

        assertEquals(true, viewModel.biometricLockEnabled.value)

        viewModel.setBiometricLockEnabled(false)

        io.mockk.verify { preferences.setEnabled(false) }
    }
}
