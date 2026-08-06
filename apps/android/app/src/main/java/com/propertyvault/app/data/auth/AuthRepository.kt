package com.propertyvault.app.data.auth

import kotlinx.coroutines.flow.StateFlow

data class OrgMembership(val orgId: String, val role: String, val status: String)

sealed interface AuthState {
    data object Loading : AuthState
    data object Unauthenticated : AuthState
    data class Authenticated(val userId: String, val organizations: List<OrgMembership>) : AuthState
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
}
