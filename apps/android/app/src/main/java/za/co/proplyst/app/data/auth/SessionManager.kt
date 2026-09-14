package za.co.proplyst.app.data.auth

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Session token storage -- NATIVE_ANDROID_SPEC.md §12: EncryptedSharedPreferences with a
 * Keystore-backed master key, the Android equivalent of iOS's Keychain
 * `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. Android Keystore keys are hardware-backed and
 * non-exportable by design. `android:allowBackup="false"` keeps the file out of cloud backup, and
 * `res/xml/data_extraction_rules.xml` keeps it out of Android 12+ device-to-device transfer, which
 * `allowBackup` alone does not stop.
 *
 * The store itself is opened lazily through [RecoverableSessionStorage]: an encrypted file this
 * device can no longer decrypt resets to "signed out" instead of crashing app start (see that
 * class for the failure modes).
 */
@Singleton
class SessionManager internal constructor(private val storage: SessionStorage) {

    @Inject
    constructor(@ApplicationContext context: Context) :
        this(RecoverableSessionStorage(EncryptedPrefsSessionStorageOpener(context)))

    fun saveSession(accessToken: String, refreshToken: String, userId: String) {
        storage.write(
            mapOf(
                KEY_ACCESS_TOKEN to accessToken,
                KEY_REFRESH_TOKEN to refreshToken,
                KEY_USER_ID to userId,
            ),
        )
    }

    fun getAccessToken(): String? = storage.read(KEY_ACCESS_TOKEN)
    fun getRefreshToken(): String? = storage.read(KEY_REFRESH_TOKEN)
    fun getUserId(): String? = storage.read(KEY_USER_ID)

    /** Display email for the signed-in account (fidelity audit pass: lock screen / returning-user
     * row / avatar initial). A display identifier, not a credential -- stored in the same
     * encrypted prefs purely because that file already carries the account's identity and is
     * cleared atomically with it on sign-out. Saved separately from [saveSession] so the
     * TokenAuthenticator refresh path (which has no email in its response) never wipes it. */
    fun saveEmail(email: String?) {
        storage.write(mapOf(KEY_EMAIL to email))
    }

    fun getEmail(): String? = storage.read(KEY_EMAIL)

    fun clear() {
        storage.clear()
    }

    private companion object {
        const val KEY_ACCESS_TOKEN = "access_token"
        const val KEY_REFRESH_TOKEN = "refresh_token"
        const val KEY_USER_ID = "user_id"
        const val KEY_EMAIL = "email"
    }
}
