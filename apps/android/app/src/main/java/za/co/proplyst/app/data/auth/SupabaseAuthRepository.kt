package za.co.proplyst.app.data.auth

import za.co.proplyst.app.data.biometric.BiometricLockPreferences
import za.co.proplyst.app.data.network.PostgrestApi
import za.co.proplyst.app.data.network.SupabaseAuthApi
import retrofit2.Response
import za.co.proplyst.app.data.network.dto.AuthSessionResponse
import za.co.proplyst.app.data.network.dto.IdTokenSignInRequest
import za.co.proplyst.app.data.network.dto.RecoverPasswordRequest
import za.co.proplyst.app.data.network.dto.SignInRequest
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
    private val authEventStore: AuthEventStore,
    private val biometricLockPreferences: BiometricLockPreferences,
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
            AuthState.Authenticated(userId, memberships, fetchTenancies(userId))
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
            establishSession(response, fallbackEmail = email, failureLabel = "Sign-in failed")
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * "Continue with Google". The Google ID token is exchanged by Supabase for one of its own
     * sessions, then everything after that is the password flow's code, unchanged: the same
     * encrypted session store, the same org/tenancy lookup, the same AuthState. That is what makes
     * the app and the web two clients of one Proplyst account rather than two accounts -- Supabase
     * resolves the Google identity to an existing auth user when there is one, and creates a single
     * new one (with its profile row, via the database's own on_auth_user_created trigger) when
     * there is not. The app provisions nothing itself.
     */
    override suspend fun signInWithGoogle(idToken: String, rawNonce: String): Result<Unit> {
        return try {
            val response = authApi.signInWithIdToken(
                body = IdTokenSignInRequest(provider = "google", idToken = idToken, nonce = rawNonce),
            )
            establishSession(response, fallbackEmail = null, failureLabel = "Google sign-in failed")
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** The single place a successful sign-in becomes a persisted session and an authenticated
     * state, shared by every sign-in method so they cannot drift apart. */
    private suspend fun establishSession(
        response: Response<AuthSessionResponse>,
        fallbackEmail: String?,
        failureLabel: String,
    ): Result<Unit> {
        val session = response.body()
        if (!response.isSuccessful || session == null) {
            return Result.failure(Exception("$failureLabel (${response.code()})"))
        }
        sessionManager.saveSession(session.accessToken, session.refreshToken, session.user.id)
        (session.user.email ?: fallbackEmail)?.let(sessionManager::saveEmail)
        val memberships = fetchOrgMemberships(session.user.id) ?: emptyList()
        _authState.value = AuthState.Authenticated(
            session.user.id,
            memberships,
            fetchTenancies(session.user.id),
        )
        return Result.success(Unit)
    }

    override suspend fun signOut() {
        authEventStore.recordUserSignOut()
        try {
            // scope=local (the default argument): revokes this device's session and no other.
            authApi.signOut()
        } catch (_: Exception) {
            // Best-effort server-side revocation -- clearing the local session below is what
            // actually matters for this device; a failed network call here must never block
            // sign-out.
        }
        // The sign-out dialog promises "Fingerprint unlock on this device will be turned off": an
        // app lock guarding a signed-out app is meaningless, and the next account on this device
        // must opt in again for itself.
        biometricLockPreferences.setEnabled(false)
        forceSignOutLocally()
    }

    override fun forceSignOutLocally() {
        // Presentation-only signal (fidelity audit §1): reaching here without a preceding
        // explicit signOut() means the session died underneath the user (unrecoverable refresh
        // failure) -- the sign-in screen shows the "Session expired" banner for it. Never
        // consulted by any auth logic. USER (set by signOut() below before it calls this) wins.
        authEventStore.recordExpiredIfUnset()
        sessionManager.clear()
        _authState.value = AuthState.Unauthenticated
    }

    override suspend fun sendPasswordReset(email: String): Result<Unit> {
        return try {
            authApi.recoverPassword(RecoverPasswordRequest(email))
            // Always success from here regardless of the response body/status nuance -- see this
            // method's own doc comment on AuthRepository for why account existence is never
            // revealed via this call's outcome.
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
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

    /** Best-effort: a tenancy-lookup failure must never block sign-in for an owner/staff account
     * (whose membership fetch already succeeded, above) -- falls back to "no tenancies," which is
     * simply the correct answer for the overwhelmingly common owner/staff caller anyway. */
    private suspend fun fetchTenancies(userId: String): List<TenancyMembership> {
        return try {
            val response = postgrestApi.getMyTenancies(userIdFilter = "eq.$userId")
            if (!response.isSuccessful) return emptyList()
            response.body()?.map { TenancyMembership(it.id, it.orgId, it.status) } ?: emptyList()
        } catch (_: Exception) {
            emptyList()
        }
    }
}
