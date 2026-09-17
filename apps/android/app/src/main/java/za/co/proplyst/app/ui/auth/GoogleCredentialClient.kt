package za.co.proplyst.app.ui.auth

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import za.co.proplyst.app.data.auth.GoogleSignInNonceFactory
import javax.inject.Inject
import javax.inject.Singleton

/** What the Google account picker returned. Every failure the user can actually cause has its own
 * case, so the sign-in screen can stay quiet when they simply changed their mind. */
sealed interface GoogleCredentialResult {
    /** [rawNonce] must be sent to Supabase; Google only ever saw its hash. */
    data class Success(val idToken: String, val rawNonce: String) : GoogleCredentialResult

    /** Back-pressed or dismissed. Not an error: the screen shows nothing. */
    data object Cancelled : GoogleCredentialResult

    /** No Google account on the device, or none that may be offered to this app. */
    data object NoGoogleAccount : GoogleCredentialResult

    data class Failed(val message: String) : GoogleCredentialResult
}

/**
 * Wraps Credential Manager's "Sign in with Google" so the ViewModel never touches Google types.
 *
 * Nothing secret lives here: [serverClientId] is the project's public OAuth Web client ID, which
 * Supabase is already configured with, and the ID token it returns is verified server-side by
 * Supabase (signature, issuer, audience, nonce) before any session exists.
 */
@Singleton
class GoogleCredentialClient @Inject constructor() {

    suspend fun requestIdToken(activity: Activity, serverClientId: String): GoogleCredentialResult {
        if (serverClientId.isBlank()) {
            return GoogleCredentialResult.Failed("Google Sign-In needs to be configured by Proplyst before it can be used.")
        }
        val nonce = GoogleSignInNonceFactory.generate()
        val manager = CredentialManager.create(activity)

        // The button flow first. GetSignInWithGoogleOption is what Google documents for an explicit
        // "Sign in with Google" tap: it always opens the full account chooser, including "use
        // another account". GetGoogleIdOption is the quieter one-tap variant, and on a real Samsung
        // device it answered NoCredentialException even with Google accounts signed in -- which the
        // app then reported, wrongly, as "no Google account is available".
        val buttonFlow = GetCredentialRequest.Builder()
            .addCredentialOption(
                GetSignInWithGoogleOption.Builder(serverClientId)
                    .setNonce(nonce.hashed)
                    .build(),
            )
            .build()

        // Fallback for devices where the button flow finds nothing to show but an already-authorised
        // account exists. filterByAuthorizedAccounts=false so a first-time Google user can still sign
        // up from the app, exactly as they can on the web.
        val oneTapFlow = GetCredentialRequest.Builder()
            .addCredentialOption(
                GetGoogleIdOption.Builder()
                    .setServerClientId(serverClientId)
                    .setFilterByAuthorizedAccounts(false)
                    .setAutoSelectEnabled(false)
                    .setNonce(nonce.hashed)
                    .build(),
            )
            .build()

        return when (val first = attempt(manager, activity, buttonFlow, nonce.raw)) {
            is GoogleCredentialResult.NoGoogleAccount -> attempt(manager, activity, oneTapFlow, nonce.raw)
            else -> first
        }
    }

    private suspend fun attempt(
        manager: CredentialManager,
        activity: Activity,
        request: GetCredentialRequest,
        rawNonce: String,
    ): GoogleCredentialResult = try {
        val credential = manager.getCredential(activity, request).credential
        if (credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            GoogleCredentialResult.Failed("Google returned an unexpected sign-in type.")
        } else {
            val idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
            if (idToken.isBlank()) {
                GoogleCredentialResult.Failed("Google did not return a sign-in token. Try again.")
            } else {
                GoogleCredentialResult.Success(idToken = idToken, rawNonce = rawNonce)
            }
        }
    } catch (_: GetCredentialCancellationException) {
        GoogleCredentialResult.Cancelled
    } catch (_: NoCredentialException) {
        GoogleCredentialResult.NoGoogleAccount
    } catch (e: GetCredentialException) {
        // A build whose signing certificate is not registered against this app's Google OAuth client
        // lands here (or, on some devices, in NoCredentialException). Google's own text is kept: it
        // is the only thing that distinguishes "Play services is out of date" from the rest.
        GoogleCredentialResult.Failed(
            e.message?.takeIf { it.isNotBlank() } ?: "Google sign-in couldn't start on this device.",
        )
    } catch (e: Exception) {
        GoogleCredentialResult.Failed(e.message ?: "Google sign-in couldn't start on this device.")
    }
}
