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
 */
@Singleton
class MockAuthRepository @Inject constructor() : AuthRepository {
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
        _authState.value = AuthState.Authenticated(
            userId = "demo-user-1",
            organizations = listOf(OrgMembership(orgId = "demo-org-1", role = "principal", status = "active")),
        )
        return Result.success(Unit)
    }

    override suspend fun signOut() {
        delay(100)
        _authState.value = AuthState.Unauthenticated
    }
}
