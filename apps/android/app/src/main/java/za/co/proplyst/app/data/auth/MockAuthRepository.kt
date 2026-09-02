package za.co.proplyst.app.data.auth

import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Deterministic fake session -- any non-blank email/password "succeeds," matching
 * MockPropertiesRepository's fixture-data pattern. Never wired into the same binding as
 * SupabaseAuthRepository (Mohammed's explicit instruction).
 *
 * Proplyst Mobile Design System redesign pass -- development-only role selector (spec §30): this
 * class only exists in the binding graph when `BuildConfig.USE_MOCK_DATA` is true, which is itself
 * hardcoded `false` for every release build (`app/build.gradle.kts` release block) regardless of a
 * developer's own `local.properties`, so this can never reach a real device build or weaken server
 * authorization -- the real role gate (`requireOrgRole`/RLS) is untouched and unaware this exists.
 * An email starting with "tenant" (case-insensitive) signs in as the tenant fixture; anything else
 * signs in as the existing owner/staff fixture, exactly as before this pass. This lets the
 * emulator smoke test exercise both portals without inventing a real backend switcher.
 */
@Singleton
class MockAuthRepository @Inject constructor(
    private val authEventStore: AuthEventStore,
    private val sessionManager: SessionManager,
) : AuthRepository {
    private val _authState = MutableStateFlow<AuthState>(AuthState.Unauthenticated)
    override val authState: StateFlow<AuthState> = _authState.asStateFlow()

    override suspend fun restoreSession() {
        delay(300)
        // Mock mode always starts signed-out, same as a fresh real install would -- restoreSession()
        // finding no stored token is the common case this is standing in for.
        _authState.value = AuthState.Unauthenticated
    }

    override suspend fun signIn(email: String, password: String): Result<Unit> {
        delay(400)
        if (email.isBlank() || password.isBlank()) {
            return Result.failure(Exception("Email and password are required."))
        }
        // Same display-identifier persistence as the real repository -- the Owner/Tenant home
        // avatar initial and the Security screen's account row read it (fidelity audit §2/§6).
        sessionManager.saveEmail(email.trim())
        _authState.value = if (email.trim().lowercase().startsWith("tenant")) {
            AuthState.Authenticated(
                userId = "demo-tenant-user-1",
                organizations = emptyList(),
                tenancies = listOf(TenancyMembership(tenantId = "demo-tenant-1", orgId = "demo-org-1", status = "active")),
            )
        } else {
            AuthState.Authenticated(
                userId = "demo-user-1",
                organizations = listOf(OrgMembership(orgId = "demo-org-1", role = "principal", status = "active")),
            )
        }
        return Result.success(Unit)
    }

    override suspend fun signOut() {
        delay(100)
        authEventStore.recordUserSignOut()
        sessionManager.clear()
        _authState.value = AuthState.Unauthenticated
    }

    override fun forceSignOutLocally() {
        authEventStore.recordExpiredIfUnset()
        sessionManager.clear()
        _authState.value = AuthState.Unauthenticated
    }

    override suspend fun sendPasswordReset(email: String): Result<Unit> {
        delay(300)
        return Result.success(Unit)
    }
}
