package za.co.proplyst.app.data.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.GeneralSecurityException

/**
 * RecoverableSessionStorage (2026-09-14, Android release P0): an encrypted session store this device
 * can no longer read -- a keyset restored by device transfer without its Keystore key, an invalidated
 * key, a corrupted file -- must reset to "signed out", never crash app start or loop.
 */
class RecoverableSessionStorageTest {

    /** An in-memory stand-in for EncryptedSharedPreferences that can be told to fail. */
    private class FakeEncryptedStore : SessionStorage {
        val values = HashMap<String, String>()
        var failReads = false
        var failWrites = false
        override fun read(key: String): String? {
            if (failReads) throw GeneralSecurityException("keyset cannot be decrypted")
            return values[key]
        }
        override fun write(values: Map<String, String?>) {
            if (failWrites) throw GeneralSecurityException("cannot encrypt")
            for ((k, v) in values) if (v == null) this.values.remove(k) else this.values[k] = v
        }
        override fun clear() = values.clear()
    }

    private class FakeOpener(private val failOpens: Int) : SessionStorageOpener {
        var opens = 0
        var wipes = 0
        var store = FakeEncryptedStore()
        override fun open(): SessionStorage {
            opens++
            if (opens <= failOpens) throw GeneralSecurityException("Could not decrypt keyset")
            return store
        }
        override fun wipe() {
            wipes++
            store = FakeEncryptedStore() // the unreadable file and key are gone; a new store starts empty
        }
    }

    @Test
    fun `a healthy store round-trips values without wiping anything`() {
        val opener = FakeOpener(failOpens = 0)
        val storage = RecoverableSessionStorage(opener)
        storage.write(mapOf("access_token" to "a", "refresh_token" to "r"))

        assertEquals("a", storage.read("access_token"))
        assertEquals("r", storage.read("refresh_token"))
        assertEquals(0, opener.wipes)
        assertEquals(1, opener.opens) // opened once, lazily, and reused
        storage.clear()
        assertNull(storage.read("access_token"))
    }

    @Test
    fun `a store that cannot be opened (transferred keyset, missing key) is wiped and reads as signed out`() {
        val opener = FakeOpener(failOpens = 1)
        val storage = RecoverableSessionStorage(opener)

        assertNull(storage.read("access_token")) // no exception
        assertEquals(1, opener.wipes)
        assertFalse(storage.isUsingInMemoryFallback)

        // Signing in again persists normally into the recreated encrypted store.
        storage.write(mapOf("access_token" to "fresh"))
        assertEquals("fresh", opener.store.values["access_token"])
    }

    @Test
    fun `a store that opens but can no longer decrypt its values is wiped, and the stale session is not returned`() {
        val opener = FakeOpener(failOpens = 0)
        val storage = RecoverableSessionStorage(opener)
        storage.write(mapOf("access_token" to "stale"))
        opener.store.failReads = true // e.g. the Keystore key was invalidated while the app ran

        assertNull(storage.read("access_token"))
        assertEquals(1, opener.wipes)
        assertEquals(null, storage.read("access_token"))
    }

    @Test
    fun `a write that cannot be encrypted recovers and lands in the recreated store`() {
        val opener = FakeOpener(failOpens = 0)
        val storage = RecoverableSessionStorage(opener)
        storage.read("warm-up")
        opener.store.failWrites = true

        storage.write(mapOf("access_token" to "new"))
        assertEquals(1, opener.wipes)
        assertEquals("new", storage.read("access_token"))
    }

    @Test
    fun `if the encrypted store can never be opened, the session lives in memory for this process only -- no crash`() {
        val opener = FakeOpener(failOpens = Int.MAX_VALUE)
        val storage = RecoverableSessionStorage(opener)

        assertNull(storage.read("access_token"))
        assertTrue(storage.isUsingInMemoryFallback)
        storage.write(mapOf("access_token" to "in-memory"))
        assertEquals("in-memory", storage.read("access_token"))
        storage.clear()
        assertNull(storage.read("access_token"))
        assertEquals(1, opener.wipes) // recovery was tried once, not in a loop
    }

    @Test
    fun `SessionManager over an unreadable store starts signed out instead of throwing`() {
        val opener = FakeOpener(failOpens = 1)
        val sessionManager = SessionManager(RecoverableSessionStorage(opener))

        assertNull(sessionManager.getAccessToken())
        assertNull(sessionManager.getRefreshToken())
        assertNull(sessionManager.getUserId())
        sessionManager.saveSession("access", "refresh", "user-1")
        sessionManager.saveEmail("owner@example.test")
        assertEquals("access", sessionManager.getAccessToken())
        assertEquals("owner@example.test", sessionManager.getEmail())
        sessionManager.clear()
        assertNull(sessionManager.getAccessToken())
    }
}
