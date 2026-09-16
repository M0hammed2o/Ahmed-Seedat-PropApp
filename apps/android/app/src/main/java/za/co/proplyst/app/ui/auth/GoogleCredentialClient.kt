package za.co.proplyst.app.ui.auth

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
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
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(
                GetGoogleIdOption.Builder()
                    .setServerClientId(serverClientId)
                    // false: also offer accounts that have never used Proplyst, so a first-time
                    // Google user can sign up from the app exactly as they can on the web.
                    .setFilterByAuthorizedAccounts(false)
                    .setAutoSelectEnabled(false)
                    .setNonce(nonce.hashed)
                    .build(),
            )
            .build()

        return try {
            val response = CredentialManager.create(activity).getCredential(activity, request)
            val credential = response.credential
            if (credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                return GoogleCredentialResult.Failed("Google returned an unexpected sign-in type.")
            }
            val idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
            if (idToken.isBlank()) {
                GoogleCredentialResult.Failed("Google did not return a sign-in token. Try again.")
            } else {
                GoogleCredentialResult.Success(idToken = idToken, rawNonce = nonce.raw)
            }
        } catch (_: GetCredentialCancellationException) {
            GoogleCredentialResult.Cancelled
        } catch (_: NoCredentialException) {
            GoogleCredentialResult.NoGoogleAccount
        } catch (e: GetCredentialException) {
            // Covers a device with no Play services, and a build whose signing certificate is not
            // registered against this app's Google OAuth client -- both look the same from here.
            GoogleCredentialResult.Failed(e.message ?: "Google sign-in couldn't start on this device.")
        } catch (e: Exception) {
            GoogleCredentialResult.Failed(e.message ?: "Google sign-in couldn't start on this device.")
        }
    }
}
