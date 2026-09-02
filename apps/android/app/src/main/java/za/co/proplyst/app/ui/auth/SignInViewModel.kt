package za.co.proplyst.app.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import za.co.proplyst.app.BuildConfig
import za.co.proplyst.app.data.auth.AuthEventStore
import za.co.proplyst.app.data.auth.AuthRepository
import za.co.proplyst.app.data.auth.SessionManager
import za.co.proplyst.app.data.auth.SignOutReason
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.IOException
import java.net.UnknownHostException
import javax.inject.Inject

/** Sign-in banner kind (fidelity audit §1 -- invalid / network / expired banners are visually
 * distinct: red dot, wifi-off + Retry, blue clock respectively). */
enum class SignInErrorKind { INVALID_CREDENTIALS, NETWORK, SESSION_EXPIRED, GENERIC }

data class SignInUiState(
    val email: String = "",
    val password: String = "",
    val showPassword: Boolean = false,
    val isSubmitting: Boolean = false,
    val errorMessage: String? = null,
    val errorKind: SignInErrorKind? = null,
    val mode: SignInMode = SignInMode.SIGN_IN,
    val forgotEmail: String = "",
    val isSendingReset: Boolean = false,
    /** "You've been signed out" pill toast on the hero (audit §1) -- one-shot, from
     * [AuthEventStore]. */
    val showSignedOutToast: Boolean = false,
)

enum class SignInMode { SIGN_IN, FORGOT_PASSWORD, FORGOT_SENT }

@HiltViewModel
class SignInViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val authEventStore: AuthEventStore,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SignInUiState())
    val uiState: StateFlow<SignInUiState> = _uiState.asStateFlow()

    /** Google Sign-In (spec §7): only ever true when a real OAuth web client ID has been
     * configured via local.properties -- never fabricated. */
    val googleSignInAvailable: Boolean = BuildConfig.GOOGLE_WEB_CLIENT_ID.isNotBlank()

    /** Display email for the returning-user row / expired prefill (display identifier only). */
    val storedEmail: String? = sessionManager.getEmail()

    private var lastOnSuccess: (() -> Unit)? = null

    init {
        // One-shot: why did we arrive at sign-in? Drives the approved expired-banner /
        // signed-out-toast visuals (audit §1) -- presentation only, no auth logic reads this.
        when (authEventStore.consume()) {
            SignOutReason.EXPIRED -> _uiState.value = _uiState.value.copy(
                email = storedEmail.orEmpty(),
                errorKind = SignInErrorKind.SESSION_EXPIRED,
                errorMessage = "Your session expired. Sign in again to continue.",
            )
            SignOutReason.USER -> _uiState.value = _uiState.value.copy(showSignedOutToast = true)
            null -> Unit
        }
    }

    fun onEmailChange(value: String) {
        _uiState.value = _uiState.value.copy(email = value, errorMessage = null, errorKind = null)
    }

    fun onPasswordChange(value: String) {
        _uiState.value = _uiState.value.copy(password = value, errorMessage = null, errorKind = null)
    }

    fun onTogglePasswordVisibility() {
        _uiState.value = _uiState.value.copy(showPassword = !_uiState.value.showPassword)
    }

    fun onForgotPasswordClick() {
        _uiState.value = _uiState.value.copy(mode = SignInMode.FORGOT_PASSWORD, forgotEmail = _uiState.value.email)
    }

    fun onBackToSignIn() {
        _uiState.value = _uiState.value.copy(mode = SignInMode.SIGN_IN)
    }

    fun onForgotEmailChange(value: String) {
        _uiState.value = _uiState.value.copy(forgotEmail = value)
    }

    fun sendPasswordReset() {
        val email = _uiState.value.forgotEmail.trim()
        if (email.isBlank()) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isSendingReset = true)
            authRepository.sendPasswordReset(email)
            // Always moves to "sent" regardless of outcome -- see AuthRepository
            // .sendPasswordReset's own doc comment on why account existence is never revealed.
            _uiState.value = _uiState.value.copy(isSendingReset = false, mode = SignInMode.FORGOT_SENT)
        }
    }

    /** Google button tap when [googleSignInAvailable] is false -- the button must never pretend
     * authentication succeeded when configuration is missing (spec §7). */
    fun onGoogleSignInUnavailable() {
        _uiState.value = _uiState.value.copy(
            errorMessage = "Google Sign-In needs to be configured by Proplyst before it can be used.",
            errorKind = SignInErrorKind.GENERIC,
        )
    }

    /** Underlined "Retry" on the network banner (audit §1) -- re-runs the last attempt. */
    fun retry() {
        val onSuccess = lastOnSuccess ?: return
        signIn(onSuccess)
    }

    fun signIn(onSuccess: () -> Unit) {
        val state = _uiState.value
        if (state.email.isBlank() || state.password.isBlank()) return // button is disabled anyway
        lastOnSuccess = onSuccess
        viewModelScope.launch {
            _uiState.value = state.copy(isSubmitting = true, errorMessage = null, errorKind = null, showSignedOutToast = false)
            val result = authRepository.signIn(state.email.trim(), state.password)
            result.fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(isSubmitting = false)
                    onSuccess()
                },
                onFailure = { error ->
                    val kind = when (error) {
                        is IOException, is UnknownHostException -> SignInErrorKind.NETWORK
                        else -> if (error.message?.contains("credentials", ignoreCase = true) == true ||
                            error.message?.contains("Sign-in failed", ignoreCase = true) == true
                        ) {
                            SignInErrorKind.INVALID_CREDENTIALS
                        } else {
                            SignInErrorKind.GENERIC
                        }
                    }
                    val message = when (kind) {
                        SignInErrorKind.NETWORK -> "Can't reach Proplyst right now. Check your connection."
                        SignInErrorKind.INVALID_CREDENTIALS -> "That email and password don't match our records."
                        else -> error.message ?: "Sign-in failed."
                    }
                    _uiState.value = _uiState.value.copy(isSubmitting = false, errorMessage = message, errorKind = kind)
                },
            )
        }
    }
}
