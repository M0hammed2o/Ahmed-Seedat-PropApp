package za.co.proplyst.app.data.network

import za.co.proplyst.app.data.network.dto.AuthSessionResponse
import za.co.proplyst.app.data.network.dto.IdTokenSignInRequest
import za.co.proplyst.app.data.network.dto.RecoverPasswordRequest
import za.co.proplyst.app.data.network.dto.RefreshTokenRequest
import za.co.proplyst.app.data.network.dto.SignInRequest
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST
import retrofit2.http.Query

/** Supabase Auth logout scope that ends only the calling session. */
const val LOGOUT_SCOPE_THIS_DEVICE = "local"

/** Supabase Auth REST endpoints, called against BuildConfig.SUPABASE_URL (a different host than
 * the app's own API -- see NetworkModule's two separate Retrofit instances). */
interface SupabaseAuthApi {
    @POST("auth/v1/token")
    suspend fun signInWithPassword(
        @Query("grant_type") grantType: String = "password",
        @Body body: SignInRequest,
    ): Response<AuthSessionResponse>

    /** "Continue with Google" (Credential Manager). Supabase verifies the Google ID token itself --
     * signature, issuer, audience and nonce -- and returns its own session, so the app never has to
     * trust the token on its own. A Google account that already signed in on the web resolves to
     * that same auth user, never a duplicate. */
    @POST("auth/v1/token")
    suspend fun signInWithIdToken(
        @Query("grant_type") grantType: String = "id_token",
        @Body body: IdTokenSignInRequest,
    ): Response<AuthSessionResponse>

    @POST("auth/v1/token")
    suspend fun refreshSession(
        @Query("grant_type") grantType: String = "refresh_token",
        @Body body: RefreshTokenRequest,
    ): Response<AuthSessionResponse>

    /** Signs out THIS device's session only (2026-09-14, Android release P0). Supabase Auth's logout
     * defaults to `scope=global`, which revoked every session of the account -- the shared reviewer
     * account's other devices included -- while the app promised "Ends your session on this
     * device". `local` revokes only the session whose access token authorises this request. */
    @POST("auth/v1/logout")
    suspend fun signOut(@Query("scope") scope: String = LOGOUT_SCOPE_THIS_DEVICE): Response<Unit>

    /** Password reset (Proplyst Mobile Design System redesign pass, "Forgot password?" -- design
     * handoff §"Forgot / sent"). Supabase's own GoTrue "recover" endpoint always returns 200
     * regardless of whether the email matches an account, by design -- this app must not use the
     * response to reveal account existence either (matches the design's own "neutral copy that
     * does not confirm account existence"). */
    @POST("auth/v1/recover")
    suspend fun recoverPassword(@Body body: RecoverPasswordRequest): Response<Unit>
}
