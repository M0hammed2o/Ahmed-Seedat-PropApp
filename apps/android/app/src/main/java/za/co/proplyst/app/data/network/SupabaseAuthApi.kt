package za.co.proplyst.app.data.network

import za.co.proplyst.app.data.network.dto.AuthSessionResponse
import za.co.proplyst.app.data.network.dto.RecoverPasswordRequest
import za.co.proplyst.app.data.network.dto.RefreshTokenRequest
import za.co.proplyst.app.data.network.dto.SignInRequest
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST
import retrofit2.http.Query

/** Supabase Auth REST endpoints, called against BuildConfig.SUPABASE_URL (a different host than
 * the app's own API -- see NetworkModule's two separate Retrofit instances). */
interface SupabaseAuthApi {
    @POST("auth/v1/token")
    suspend fun signInWithPassword(
        @Query("grant_type") grantType: String = "password",
        @Body body: SignInRequest,
    ): Response<AuthSessionResponse>

    @POST("auth/v1/token")
    suspend fun refreshSession(
        @Query("grant_type") grantType: String = "refresh_token",
        @Body body: RefreshTokenRequest,
    ): Response<AuthSessionResponse>

    @POST("auth/v1/logout")
    suspend fun signOut(): Response<Unit>

    /** Password reset (Proplyst Mobile Design System redesign pass, "Forgot password?" -- design
     * handoff §"Forgot / sent"). Supabase's own GoTrue "recover" endpoint always returns 200
     * regardless of whether the email matches an account, by design -- this app must not use the
     * response to reveal account existence either (matches the design's own "neutral copy that
     * does not confirm account existence"). */
    @POST("auth/v1/recover")
    suspend fun recoverPassword(@Body body: RecoverPasswordRequest): Response<Unit>
}
