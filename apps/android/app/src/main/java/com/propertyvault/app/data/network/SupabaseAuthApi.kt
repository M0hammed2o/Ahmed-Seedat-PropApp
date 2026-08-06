package com.propertyvault.app.data.network

import com.propertyvault.app.data.network.dto.AuthSessionResponse
import com.propertyvault.app.data.network.dto.RefreshTokenRequest
import com.propertyvault.app.data.network.dto.SignInRequest
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
}
