package za.co.proplyst.app.ui.biometric

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** NATIVE_ANDROID_SPEC.md §12: `BIOMETRIC_STRONG or DEVICE_CREDENTIAL` -- fingerprint/face with a
 * system PIN/pattern/password fallback, never a custom PIN screen built by this app. Combining
 * DEVICE_CREDENTIAL with a custom negative-button label is rejected by BiometricPrompt at
 * runtime (the API provides its own "Use PIN" affordance instead) -- deliberately no
 * `setNegativeButtonText()` call anywhere this is used. */
internal const val ALLOWED_AUTHENTICATORS =
    BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL

enum class BiometricAvailability { AVAILABLE, NO_HARDWARE, NOT_ENROLLED, UNAVAILABLE }

fun checkBiometricAvailability(context: Context): BiometricAvailability =
    when (BiometricManager.from(context).canAuthenticate(ALLOWED_AUTHENTICATORS)) {
        BiometricManager.BIOMETRIC_SUCCESS -> BiometricAvailability.AVAILABLE
        BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE,
        BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE,
        -> BiometricAvailability.NO_HARDWARE
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> BiometricAvailability.NOT_ENROLLED
        else -> BiometricAvailability.UNAVAILABLE
    }

sealed interface BiometricResult {
    data object Success : BiometricResult
    data object Cancelled : BiometricResult
    data class Failed(val message: String) : BiometricResult
}

/**
 * Client-side-only app-unlock gate (NATIVE_ANDROID_SPEC.md §12). Success here only clears the
 * local `locked` flag in [BiometricGateViewModel] -- it never touches SessionManager or
 * AuthRepository, and never substitutes for or extends the JWT session's own expiry/refresh
 * cycle, exactly as the spec requires. Bridges BiometricPrompt's callback API to a suspend
 * function via `suspendCancellableCoroutine`, the standard pattern for this -- BiometricPrompt
 * itself requires a real FragmentActivity host, so this cannot be a Hilt singleton (the Activity
 * is recreated across configuration changes); callers construct/call it per-Activity instead.
 */
suspend fun authenticateWithBiometrics(
    activity: FragmentActivity,
    title: String,
    subtitle: String? = null,
): BiometricResult =
    suspendCancellableCoroutine { continuation ->
        val executor = ContextCompat.getMainExecutor(activity)
        val prompt = BiometricPrompt(
            activity,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    if (continuation.isActive) continuation.resume(BiometricResult.Success)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    if (!continuation.isActive) return
                    val result = if (
                        errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                        errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                        errorCode == BiometricPrompt.ERROR_CANCELED
                    ) {
                        BiometricResult.Cancelled
                    } else {
                        BiometricResult.Failed(errString.toString())
                    }
                    continuation.resume(result)
                }

                override fun onAuthenticationFailed() {
                    // One rejected attempt (e.g. wrong finger) -- the system prompt itself stays
                    // open and lets the user retry; this fires per-attempt, not once the whole
                    // prompt gives up (onAuthenticationError above is the terminal outcome).
                }
            },
        )
        // Fidelity audit §6: subtitle "Use your fingerprint to continue" on the system sheet. The
        // audit's `setNegativeButtonText("Use password")` is deliberately NOT applied -- this app
        // uses BIOMETRIC_STRONG or DEVICE_CREDENTIAL (system PIN/pattern fallback), and
        // BiometricPrompt rejects a custom negative button in that mode; dropping DEVICE_CREDENTIAL
        // just for the label would change real unlock behaviour, which this pass must not do. The
        // design's "Use password instead" affordance lives on the app's own lock screen instead.
        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .apply { if (subtitle != null) setSubtitle(subtitle) }
            .setAllowedAuthenticators(ALLOWED_AUTHENTICATORS)
            .build()
        prompt.authenticate(promptInfo)
        continuation.invokeOnCancellation { prompt.cancelAuthentication() }
    }
