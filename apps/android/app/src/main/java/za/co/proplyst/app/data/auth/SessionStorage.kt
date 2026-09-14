package za.co.proplyst.app.data.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.KeyStore

/** The key/value surface [SessionManager] needs from its backing store. */
interface SessionStorage {
    fun read(key: String): String?
    fun write(values: Map<String, String?>)
    fun clear()
}

/** Opens the real store, and can destroy an unusable one so it can be recreated. */
interface SessionStorageOpener {
    /** May throw: an unreadable keyset, a missing Keystore key, a Tink/Keystore failure. */
    fun open(): SessionStorage

    /** Deletes the stored session file and its master key -- the only way back from a keyset that
     * can never be decrypted again. Must not throw. */
    fun wipe()
}

/**
 * Session storage that survives an encrypted store it cannot read (2026-09-14, Android release P0).
 *
 * EncryptedSharedPreferences keeps its keyset in the same prefs file, encrypted with a Keystore key.
 * The file can outlive that key -- Android 12+ device-to-device transfer copies app data but never
 * Keystore keys, a key can be invalidated, a prefs file can be corrupted -- and then every open or
 * read throws. Before this, SessionManager opened the store in its constructor with no handling, so
 * that throw took down app start, every launch, until the user cleared app data.
 *
 * Now any failure wipes the unusable file and key and starts again empty: the user is simply signed
 * out. If the store still cannot be opened, the session is held in memory for this process only --
 * never written to plain SharedPreferences -- and the next launch tries the encrypted store again.
 * Nothing here logs, and no stored value is ever put into an exception.
 */
class RecoverableSessionStorage(private val opener: SessionStorageOpener) : SessionStorage {
    private var delegate: SessionStorage? = null

    @Synchronized
    override fun read(key: String): String? = attempt({ it.read(key) }, onUnrecoverable = { null })

    @Synchronized
    override fun write(values: Map<String, String?>) = attempt({ it.write(values) }, onUnrecoverable = {})

    @Synchronized
    override fun clear() = attempt({ it.clear() }, onUnrecoverable = {})

    /** True once the encrypted store could not be used at all and memory is standing in for it. */
    @get:Synchronized
    val isUsingInMemoryFallback: Boolean
        get() = delegate is InMemorySessionStorage

    private fun <T> attempt(action: (SessionStorage) -> T, onUnrecoverable: () -> T): T {
        val current = delegate ?: openOrRecover(wipeFirst = false)
        return try {
            action(current)
        } catch (_: Exception) {
            // The store opened but cannot be read or written -- same treatment as a failed open. Its
            // session is gone either way, and the retry runs against the fresh, empty store: a read
            // comes back null (signed out), a write lands in the new store.
            val recovered = openOrRecover(wipeFirst = true)
            try {
                action(recovered)
            } catch (_: Exception) {
                onUnrecoverable()
            }
        }
    }

    private fun openOrRecover(wipeFirst: Boolean): SessionStorage {
        if (!wipeFirst) {
            try {
                return opener.open().also { delegate = it }
            } catch (_: Exception) {
                // Unreadable keyset or missing key: wipe below and start again empty.
            }
        }
        opener.wipe()
        return try {
            opener.open()
        } catch (_: Exception) {
            InMemorySessionStorage()
        }.also { delegate = it }
    }
}

/** Last-resort store: lives only as long as the process. */
class InMemorySessionStorage : SessionStorage {
    private val values = HashMap<String, String>()
    override fun read(key: String): String? = values[key]
    override fun write(values: Map<String, String?>) {
        for ((k, v) in values) if (v == null) this.values.remove(k) else this.values[k] = v
    }
    override fun clear() = values.clear()
}

/** Production store: EncryptedSharedPreferences under a Keystore-backed AES-256-GCM master key. */
class EncryptedPrefsSessionStorageOpener(private val context: Context) : SessionStorageOpener {
    override fun open(): SessionStorage {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        val prefs = EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
        return object : SessionStorage {
            override fun read(key: String): String? = prefs.getString(key, null)
            override fun write(values: Map<String, String?>) {
                val editor = prefs.edit()
                for ((k, v) in values) editor.putString(k, v)
                // commit, not apply: a write that cannot be encrypted must fail here, where
                // RecoverableSessionStorage can handle it, not later on a background thread.
                if (!editor.commit()) throw IllegalStateException("session write was not persisted")
            }
            override fun clear() {
                if (!prefs.edit().clear().commit()) throw IllegalStateException("session clear was not persisted")
            }
        }
    }

    override fun wipe() {
        runCatching { context.deleteSharedPreferences(PREFS_NAME) }
        // Only this store uses the default master key alias in this app.
        runCatching {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
        }
    }

    companion object {
        /** Historical file name -- kept so existing sessions survive this change. */
        const val PREFS_NAME = "propertyvault_session"
    }
}
