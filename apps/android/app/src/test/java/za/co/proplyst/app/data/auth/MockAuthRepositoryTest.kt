package za.co.proplyst.app.data.auth

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Proplyst Mobile Design System redesign pass -- the development-only mock role selector
 * (spec §30) that lets the emulator smoke test exercise both the Owner and Tenant portals without
 * a real backend. Only ever compiled into the binding graph when `USE_MOCK_DATA` is true, itself
 * hardcoded `false` in every release build -- see MockAuthRepository's own doc comment.
 */
class MockAuthRepositoryTest {

    @Test
    fun `an email starting with tenant signs in as the tenant fixture, no org memberships`() = runTest {
        val repository = MockAuthRepository()

        repository.signIn("tenant@example.com", "anything")

        val state = repository.authState.value
        assertTrue(state is AuthState.Authenticated)
        state as AuthState.Authenticated
        assertTrue(state.organizations.isEmpty())
        assertEquals(1, state.tenancies.size)
        assertEquals("active", state.tenancies.first().status)
    }

    @Test
    fun `a tenant email is matched case-insensitively`() = runTest {
        val repository = MockAuthRepository()

        repository.signIn("TENANT@example.com", "anything")

        val state = repository.authState.value as AuthState.Authenticated
        assertTrue(state.tenancies.isNotEmpty())
    }

    @Test
    fun `any other email signs in as the owner staff fixture, unchanged from before this pass`() = runTest {
        val repository = MockAuthRepository()

        repository.signIn("owner@example.com", "anything")

        val state = repository.authState.value
        assertTrue(state is AuthState.Authenticated)
        state as AuthState.Authenticated
        assertTrue(state.tenancies.isEmpty())
        assertEquals("principal", state.organizations.first().role)
    }
}
