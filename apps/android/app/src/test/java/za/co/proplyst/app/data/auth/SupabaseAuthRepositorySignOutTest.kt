package za.co.proplyst.app.data.auth

import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Test
import retrofit2.Response
import retrofit2.Retrofit
import za.co.proplyst.app.data.biometric.BiometricLockPreferences
import za.co.proplyst.app.data.network.LOGOUT_SCOPE_THIS_DEVICE
import za.co.proplyst.app.data.network.PostgrestApi
import za.co.proplyst.app.data.network.SupabaseAuthApi

/**
 * Android sign-out ends THIS device's session only (2026-09-14, Android release P0). Proven live
 * before the fix: the app's logout revoked a separate session of the same account, because Supabase
 * Auth's logout defaults to scope=global. The server side of the contract -- that scope=local really
 * leaves another session valid -- is proven against real Supabase Auth by
 * apps/admin/lib/__tests__/androidLocalLogout.integration.test.ts.
 */
class SupabaseAuthRepositorySignOutTest {

    private fun repository(authApi: SupabaseAuthApi, sessionManager: SessionManager, biometric: BiometricLockPreferences) =
        SupabaseAuthRepository(
            authApi = authApi,
            postgrestApi = mockk<PostgrestApi>(relaxed = true),
            sessionManager = sessionManager,
            authEventStore = mockk<AuthEventStore>(relaxed = true),
            biometricLockPreferences = biometric,
        )

    @Test
    fun `the logout request Retrofit sends carries scope=local`() = runTest {
        var sent: Request? = null
        val client = OkHttpClient.Builder()
            .addInterceptor(
                Interceptor { chain ->
                    sent = chain.request()
                    okhttp3.Response.Builder()
                        .request(chain.request())
                        .protocol(Protocol.HTTP_1_1)
                        .code(204)
                        .message("No Content")
                        .body("".toResponseBody(null))
                        .build()
                },
            )
            .build()
        val api = Retrofit.Builder()
            .baseUrl("https://project.supabase.example/")
            .client(client)
            .build()
            .create(SupabaseAuthApi::class.java)

        api.signOut()

        assertEquals("POST", sent!!.method)
        assertEquals("/auth/v1/logout", sent!!.url.encodedPath)
        assertEquals("local", sent!!.url.queryParameter("scope"))
        assertEquals("local", LOGOUT_SCOPE_THIS_DEVICE)
    }

    @Test
    fun `signOut asks for a local logout, clears this device's session and turns biometric unlock off`() = runTest {
        val authApi = mockk<SupabaseAuthApi>()
        coEvery { authApi.signOut(any()) } returns Response.success(Unit)
        val sessionManager = mockk<SessionManager>(relaxed = true)
        val biometric = mockk<BiometricLockPreferences>(relaxed = true)
        val repo = repository(authApi, sessionManager, biometric)

        repo.signOut()

        coVerify(exactly = 1) { authApi.signOut("local") }
        verify { sessionManager.clear() }
        verify { biometric.setEnabled(false) }
        assertEquals(AuthState.Unauthenticated, repo.authState.value)
    }

    @Test
    fun `a failed logout call still signs this device out locally`() = runTest {
        val authApi = mockk<SupabaseAuthApi>()
        coEvery { authApi.signOut(any()) } throws java.io.IOException("offline")
        val sessionManager = mockk<SessionManager>(relaxed = true)
        val biometric = mockk<BiometricLockPreferences>(relaxed = true)
        every { biometric.setEnabled(any()) } returns Unit
        val repo = repository(authApi, sessionManager, biometric)

        repo.signOut()

        verify { sessionManager.clear() }
        verify { biometric.setEnabled(false) }
        assertEquals(AuthState.Unauthenticated, repo.authState.value)
    }
}
