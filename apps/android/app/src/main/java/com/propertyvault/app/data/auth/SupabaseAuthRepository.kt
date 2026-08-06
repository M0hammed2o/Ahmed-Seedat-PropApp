package com.propertyvault.app.data.auth

import com.propertyvault.app.data.network.PostgrestApi
import com.propertyvault.app.data.network.SupabaseAuthApi
import com.propertyvault.app.data.network.dto.SignInRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Real implementation -- mirrors `PortalSession`/`resolvePortalSession()`'s shape
 * (apps/admin/lib/orgSession.ts) conceptually, per NATIVE_ANDROID_SPEC.md §6 -- re-implemented
 * against plain REST calls to Supabase Auth + PostgREST rather than a native SDK (see README.md).
 * No `GET /api/v1/me` endpoint exists yet in the web API (API_SPEC.md §1 documents it, but it was
 * never built in any web milestone) -- this repository resolves org membership the same way
 * `resolvePortalSession()` does, via a direct RLS-protected read of `organization_members`, which
 * `API_SPEC.md` §0's own carve-out explicitly allows a client to do directly.
 */
@Singleton
class SupabaseAuthRepository @Inject constructor(
    private val authApi: SupabaseAuthApi,
    private val postgrestApi: PostgrestApi,
    private val sessionManager: SessionManager,
) : AuthRepository {
    private val _authState = MutableStateFlow<AuthState>(AuthState.Loading)
    override val authState: StateFlow<AuthState> = _authState.asStateFlow()

    override suspend fun restoreSession() {
        val userId = sessionManager.getUserId()
        val accessToken = sessionManager.getAccessToken()
        if (userId == null || accessToken == null) {
            _authState.value = AuthState.Unauthenticated
            return
        }
        val memberships = fetchOrgMemberships(userId)
        _authState.value = if (memberships != null) {
            AuthState.Authenticated(userId, memberships)
        } else {
            // Stored token is missing/expired/invalid -- clear it rather than leaving a stale
            // credential around, and drop back to signed-out.
            sessionManager.clear()
            AuthState.Unauthenticated
        }
    }

    override suspend fun signIn(email: String, password: String): Result<Unit> {
        return try {
            val response = authApi.signInWithPassword(body = SignInRequest(email, password))
            val session = response.body()
            if (!response.isSuccessful || session == null) {
                return Result.failure(Exception("Sign-in failed (${response.code()})"))
            }
            sessionManager.saveSession(session.accessToken, session.refreshToken, session.user.id)
            val memberships = fetchOrgMemberships(session.user.id) ?: emptyList()
            _authState.value = AuthState.Authenticated(session.user.id, memberships)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    override suspend fun signOut() {
        try {
            authApi.signOut()
        } catch (_: Exception) {
            // Best-effort server-side revocation -- clearing the local session below is what
            // actually matters for this device; a failed network call here must never block
            // sign-out.
        }
        sessionManager.clear()
        _authState.value = AuthState.Unauthenticated
    }

    private suspend fun fetchOrgMemberships(userId: String): List<OrgMembership>? {
        return try {
            val response = postgrestApi.getMyOrganizationMemberships(userIdFilter = "eq.$userId")
            if (!response.isSuccessful) return null
            response.body()?.map { OrgMembership(it.orgId, it.role, it.status) }
        } catch (_: Exception) {
            null
        }
    }
}
