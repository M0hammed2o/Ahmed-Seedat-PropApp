package za.co.proplyst.app.data.auth

import java.security.MessageDigest
import java.security.SecureRandom

/**
 * The nonce pair for "Continue with Google".
 *
 * Google is handed the SHA-256 hash and echoes it into the ID token's `nonce` claim; Supabase is
 * handed the raw value and hashes it again to compare. That is what proves the token was minted
 * for this specific sign-in attempt and cannot be replayed. The project's Supabase config has
 * `external_google_skip_nonce_check = false`, so the check is live and both halves must match.
 */
data class GoogleSignInNonce(val raw: String, val hashed: String)

/** The OAuth Web client ID the app asks Google to mint ID tokens for. Blank in a build that has no
 * GOOGLE_WEB_CLIENT_ID configured, which is what hides the button rather than shipping a dead one. */
data class GoogleAuthConfig(val webClientId: String) {
    val isConfigured: Boolean get() = webClientId.isNotBlank()
}

object GoogleSignInNonceFactory {

    /** 32 bytes of randomness, hex-encoded: unguessable, and safe to put in a URL or a JSON body. */
    fun generate(random: SecureRandom = SecureRandom()): GoogleSignInNonce {
        val bytes = ByteArray(32).also(random::nextBytes)
        val raw = bytes.toHex()
        return GoogleSignInNonce(raw = raw, hashed = sha256Hex(raw))
    }

    fun sha256Hex(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).toHex()

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
}
