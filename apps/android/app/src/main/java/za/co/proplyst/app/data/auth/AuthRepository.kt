package za.co.proplyst.app.data.auth

import kotlinx.coroutines.flow.StateFlow

data class OrgMembership(val orgId: String, val role: String, val status: String)

/** A tenancy the signed-in user holds (`tenants.user_id = auth.uid()`) -- the tenant-portal
 * equivalent of OrgMembership. Android V1 Android commercial-launch pass (WORKLOG.md this date):
 * added so restoreSession()/signIn() can tell an owner/staff account from a tenant account and
 * route to the correct root (OWNER_ROOT vs TENANT_ROOT), mirroring the web app's own
 * resolvePortalSession()-vs-resolveTenantSession() split (PERMISSIONS.md "never merge role
 * systems"). */
data class TenancyMembership(val tenantId: String, val orgId: String, val status: String)

sealed interface AuthState {
    data object Loading : AuthState
    data object Unauthenticated : AuthState
    data class Authenticated(
        val userId: String,
        val organizations: List<OrgMembership>,
        val tenancies: List<TenancyMembership> = emptyList(),
    ) : AuthState
}

/**
 * Repository interface -- one real implementation (SupabaseAuthRepository, backed by the live
 * Supabase Auth + PostgREST APIs) and one mock implementation (MockAuthRepository, a deterministic
 * fake session), never mixed (same split as PropertiesRepository, Mohammed's explicit
 * instruction). Hilt binds exactly one per build via BuildConfig.USE_MOCK_DATA -- see
 * di/RepositoryModule.kt.
 */
interface AuthRepository {
    val authState: StateFlow<AuthState>
    suspend fun restoreSession()
    suspend fun signIn(email: String, password: String): Result<Unit>
    suspend fun signOut()

    /** Synchronous, non-network local sign-out -- for the one caller (TokenAuthenticator) that
     * already knows the session is dead (an unrecoverable refresh failure) and cannot itself call
     * the network-revoking [signOut] without re-entering the same auth-related OkHttpClient this
     * runs inside of. Idempotent -- safe to call even if already Unauthenticated. */
    fun forceSignOutLocally()

    /** "Forgot password?" (Proplyst Mobile Design System redesign pass) -- always resolves to
     * success from the caller's perspective (Supabase's own `recover` endpoint always returns 200
     * regardless of whether the email matches an account; this app must not use the response to
     * reveal account existence either, matching the design's own "neutral copy" requirement). */
    suspend fun sendPasswordReset(email: String): Result<Unit>
}
