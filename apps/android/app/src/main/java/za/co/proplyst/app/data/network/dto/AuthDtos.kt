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
data class AuthErrorResponse(
    @SerialName("error_description") val errorDescription: String? = null,
    val msg: String? = null,
)
