package za.co.proplyst.app.data.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Fidelity-audit pass -- the one-shot sign-out-reason signal behind the sign-in screen's
 * expired banner / signed-out toast. The load-bearing rule: an explicit USER sign-out always wins
 * over the EXPIRED path (signOut() internally calls forceSignOutLocally(), which would otherwise
 * overwrite it), and consuming clears. */
class AuthEventStoreTest {

    @Test
    fun `expired never overwrites a pending user sign-out`() {
        val store = AuthEventStore()
        store.recordUserSignOut()
        store.recordExpiredIfUnset()

        assertEquals(SignOutReason.USER, store.consume())
    }

    @Test
    fun `expired is recorded when nothing is pending`() {
        val store = AuthEventStore()
        store.recordExpiredIfUnset()

        assertEquals(SignOutReason.EXPIRED, store.consume())
    }

    @Test
    fun `consume is one-shot`() {
        val store = AuthEventStore()
        store.recordUserSignOut()

        store.consume()

        assertNull(store.consume())
    }
}
