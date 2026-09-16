package za.co.proplyst.app.data.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Supabase Auth REST API shapes (https://supabase.com/docs/reference/api/introduction --
// POST /auth/v1/token?grant_type=password). Hand-modeled rather than pulling in the full
// supabase-kt SDK for this first vertical slice -- see README.md "Why plain REST, not supabase-kt"
// for the reasoning. Field names are the API's own snake_case wire format.

@Serializable
data class SignInRequest(
    val email: String,
    val password: String,
)

/** "Continue with Google": Supabase exchanges a Google ID token for one of its own sessions
 * (`grant_type=id_token`). The same Google account always resolves to the same auth user, so the
 * web and the app land on one Proplyst account -- no separate mobile identity is created. */
@Serializable
data class IdTokenSignInRequest(
    val provider: String,
    @SerialName("id_token") val idToken: String,
    /** The RAW nonce. Supabase hashes it to compare with the token's own hashed `nonce` claim. */
    val nonce: String,
)

@Serializable
data class AuthSessionResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("expires_in") val expiresIn: Long,
    @SerialName("token_type") val tokenType: String,
    val user: AuthUserDto,
)

@Serializable
data class AuthUserDto(
    val id: String,
    val email: String? = null,
)

@Serializable
data class RefreshTokenRequest(
    @SerialName("refresh_token") val refreshToken: String,
)

@Serializable
data class RecoverPasswordRequest(
    val email: String,
)

@Serializable
data class AuthErrorResponse(
    @SerialName("error_description") val errorDescription: String? = null,
    val msg: String? = null,
)
