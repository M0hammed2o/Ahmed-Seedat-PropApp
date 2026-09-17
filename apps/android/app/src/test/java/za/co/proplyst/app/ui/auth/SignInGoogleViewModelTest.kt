package za.co.proplyst.app.ui.auth

import android.app.Activity
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import za.co.proplyst.app.data.auth.AuthEventStore
import za.co.proplyst.app.data.auth.AuthRepository
import za.co.proplyst.app.data.auth.GoogleAuthConfig
import za.co.proplyst.app.data.auth.SessionManager
import java.io.IOException

/**
 * What the sign-in screen does with each outcome of "Continue with Google" (2026-09-16). The two
 * that matter most to a real user: backing out of the account picker must look like nothing
 * happened, and a Google sign-in that Supabase rejects must not leave the screen stuck.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignInGoogleViewModelTest {

    private val dispatcher = StandardTestDispatcher()
    private val activity = mockk<Activity>(relaxed = true)

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun viewModel(
        authRepository: AuthRepository = mockk(relaxed = true),
        client: GoogleCredentialClient = mockk(relaxed = true),
        config: GoogleAuthConfig = GoogleAuthConfig("test-web-client-id.apps.googleusercontent.com"),
    ): SignInViewModel {
        val events = mockk<AuthEventStore>(relaxed = true)
        every { events.consume() } returns null
        val sessions = mockk<SessionManager>(relaxed = true)
        every { sessions.getEmail() } returns null
        return SignInViewModel(authRepository, events, sessions, client, config)
    }

    @Test
    fun `a build with no client id hides the button and never opens the picker`() = runTest(dispatcher) {
        val client = mockk<GoogleCredentialClient>(relaxed = true)
        val vm = viewModel(client = client, config = GoogleAuthConfig(""))

        assertFalse("the button must not render in an unconfigured build", vm.googleSignInAvailable)

        vm.signInWithGoogle(activity) { fail_signedIn() }
        advanceUntilIdle()

        coVerify(exactly = 0) { client.requestIdToken(any(), any()) }
        assertTrue(vm.uiState.value.errorMessage.orEmpty().contains("configured by Proplyst"))
    }

    @Test
    fun `a configured build offers the button`() {
        assertTrue(viewModel().googleSignInAvailable)
    }

    @Test
    fun `cancelling the Google picker says nothing and leaves the button usable`() = runTest(dispatcher) {
        val client = mockk<GoogleCredentialClient>()
        coEvery { client.requestIdToken(any(), any()) } returns GoogleCredentialResult.Cancelled
        val repo = mockk<AuthRepository>(relaxed = true)
        val vm = viewModel(repo, client)

        vm.signInWithGoogle(activity) { fail_signedIn() }
        advanceUntilIdle()

        assertNull("a user backing out is not an error", vm.uiState.value.errorMessage)
        assertFalse("the screen must not stay in its submitting state", vm.uiState.value.isSubmitting)
        coVerify(exactly = 0) { repo.signInWithGoogle(any(), any()) }
    }

    @Test
    fun `an unavailable Google sign-in does not claim the device has no account`() = runTest(dispatcher) {
        val client = mockk<GoogleCredentialClient>()
        coEvery { client.requestIdToken(any(), any()) } returns GoogleCredentialResult.NoGoogleAccount
        val vm = viewModel(client = client)

        vm.signInWithGoogle(activity) { fail_signedIn() }
        advanceUntilIdle()

        val message = vm.uiState.value.errorMessage.orEmpty()
        // A real Samsung device with Google accounts signed in still reached this branch, because
        // Google reports "no credential" for an unauthorised build too. Saying "no Google account is
        // available" sent the user to fix something that was never wrong.
        assertFalse(
            "must not assert that no account exists: $message",
            message.contains("No Google account is available", ignoreCase = true),
        )
        assertTrue("must name the Google account possibility", message.contains("Google account", ignoreCase = true))
        assertTrue("must name Play services", message.contains("Play services", ignoreCase = true))
        assertTrue("must offer the alternative", message.contains("email", ignoreCase = true))
        assertFalse(vm.uiState.value.isSubmitting)
    }

    @Test
    fun `a Google token is exchanged with Supabase and signs the user in`() = runTest(dispatcher) {
        val client = mockk<GoogleCredentialClient>()
        coEvery { client.requestIdToken(any(), any()) } returns
            GoogleCredentialResult.Success(idToken = "id-token", rawNonce = "raw-nonce")
        val repo = mockk<AuthRepository>(relaxed = true)
        coEvery { repo.signInWithGoogle("id-token", "raw-nonce") } returns Result.success(Unit)
        val vm = viewModel(repo, client)
        var signedIn = false

        vm.signInWithGoogle(activity) { signedIn = true }
        advanceUntilIdle()

        assertTrue("the caller must be told to navigate on", signedIn)
        assertNull(vm.uiState.value.errorMessage)
        assertFalse(vm.uiState.value.isSubmitting)
        coVerify(exactly = 1) { repo.signInWithGoogle("id-token", "raw-nonce") }
    }

    @Test
    fun `a token Supabase rejects reports a session failure, not a wrong password`() = runTest(dispatcher) {
        val client = mockk<GoogleCredentialClient>()
        coEvery { client.requestIdToken(any(), any()) } returns
            GoogleCredentialResult.Success(idToken = "id-token", rawNonce = "raw-nonce")
        val repo = mockk<AuthRepository>(relaxed = true)
        coEvery { repo.signInWithGoogle(any(), any()) } returns Result.failure(Exception("Google sign-in failed (400)"))
        val vm = viewModel(repo, client)

        vm.signInWithGoogle(activity) { fail_signedIn() }
        advanceUntilIdle()

        assertEquals(SignInErrorKind.GENERIC, vm.uiState.value.errorKind)
        assertTrue(vm.uiState.value.errorMessage.orEmpty().contains("couldn't start your session"))
        assertFalse(vm.uiState.value.isSubmitting)
    }

    @Test
    fun `losing the network mid-sign-in shows the connection banner`() = runTest(dispatcher) {
        val client = mockk<GoogleCredentialClient>()
        coEvery { client.requestIdToken(any(), any()) } returns
            GoogleCredentialResult.Success(idToken = "id-token", rawNonce = "raw-nonce")
        val repo = mockk<AuthRepository>(relaxed = true)
        coEvery { repo.signInWithGoogle(any(), any()) } returns Result.failure(IOException("offline"))
        val vm = viewModel(repo, client)

        vm.signInWithGoogle(activity) { fail_signedIn() }
        advanceUntilIdle()

        assertEquals(SignInErrorKind.NETWORK, vm.uiState.value.errorKind)
        assertTrue(vm.uiState.value.errorMessage.orEmpty().contains("connection"))
    }

    @Test
    fun `Google sign-in never runs while an email sign-in is already in flight`() = runTest(dispatcher) {
        val client = mockk<GoogleCredentialClient>()
        coEvery { client.requestIdToken(any(), any()) } returns GoogleCredentialResult.Cancelled
        val repo = mockk<AuthRepository>(relaxed = true)
        coEvery { repo.signIn(any(), any()) } coAnswers {
            kotlinx.coroutines.delay(1_000)
            Result.success(Unit)
        }
        val vm = viewModel(repo, client)
        vm.onEmailChange("person@example.com")
        vm.onPasswordChange("password")

        vm.signIn { }
        advanceUntilIdle_whileSubmitting(vm)
        vm.signInWithGoogle(activity) { fail_signedIn() }

        coVerify(exactly = 0) { client.requestIdToken(any(), any()) }
    }

    /** Lets the email sign-in start (so isSubmitting is true) without letting it finish. */
    private fun advanceUntilIdle_whileSubmitting(vm: SignInViewModel) {
        dispatcher.scheduler.runCurrent()
        assertTrue("precondition: an email sign-in is in flight", vm.uiState.value.isSubmitting)
    }

    private fun fail_signedIn(): Nothing = throw AssertionError("must not report a successful sign-in")
}
