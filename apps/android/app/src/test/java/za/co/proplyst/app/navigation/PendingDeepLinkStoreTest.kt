package za.co.proplyst.app.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PendingDeepLinkStoreTest {

    @Test
    fun `consume returns the set target`() {
        val store = PendingDeepLinkStore()
        val target = AppLinkDestination.TenantScreen(Destinations.PAYMENTS_LIST)

        store.set(target)

        assertEquals(target, store.consume())
    }

    @Test
    fun `consume clears the target, so a second consume returns null`() {
        val store = PendingDeepLinkStore()
        store.set(AppLinkDestination.OwnerScreen(Destinations.DASHBOARD))

        store.consume()

        assertNull(store.consume())
    }

    @Test
    fun `consume returns null when nothing was ever set`() {
        val store = PendingDeepLinkStore()

        assertNull(store.consume())
    }

    @Test
    fun `target StateFlow reflects the current value without consuming it`() {
        val store = PendingDeepLinkStore()
        val target = AppLinkDestination.TenantScreen(Destinations.DOCUMENTS_LIST)

        store.set(target)

        assertEquals(target, store.target.value)
        assertEquals(target, store.target.value) // reading twice does not clear it
    }
}
