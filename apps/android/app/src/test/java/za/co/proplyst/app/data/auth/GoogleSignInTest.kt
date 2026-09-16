package za.co.proplyst.app.data.auth

import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Response
import retrofit2.Retrofit
import za.co.proplyst.app.data.biometric.BiometricLockPreferences
import za.co.proplyst.app.data.network.PostgrestApi
import za.co.proplyst.app.data.network.SerializationConverterFactory
import za.co.proplyst.app.data.network.SupabaseAuthApi
import za.co.proplyst.app.data.network.dto.AuthSessionResponse
import za.co.proplyst.app.data.network.dto.AuthUserDto
import za.co.proplyst.app.data.network.dto.IdTokenSignInRequest
import java.security.SecureRandom

/**
 * "Continue with Google" (2026-09-16). Google mints an ID token; Supabase -- not this app -- verifies
 * it and returns a session. These pin the parts that decide whether the app lands on the SAME
 * Proplyst account the web uses: the grant sent to Supabase, the nonce pair, and the fact that a
 * Google sign-in persists its session through exactly the same path as an email sign-in.
 */
class GoogleSignInTest {

    private fun session(userId: String = "user-1", email: String? = "person@example.com") = AuthSessionResponse(
        accessToken = "access-token",
        refreshToken = "refresh-token",
        expiresIn = 3600,
        tokenType = "bearer",
        user = AuthUserDto(id = userId, email = email),
    )

    private fun repository(authApi: SupabaseAuthApi, sessionManager: SessionManager) = SupabaseAuthRepository(
        authApi = authApi,
        postgrestApi = mockk<PostgrestApi>(relaxed = true),
        sessionManager = sessionManager,
        authEventStore = mockk<AuthEventStore>(relaxed = true),
        biometricLockPreferences = mockk<BiometricLockPreferences>(relaxed = true),
    )

    @Test
    fun `the nonce Google sees is the hash of the one Supabase is given`() {
        val nonce = GoogleSignInNonceFactory.generate()

        assertEquals("raw nonce is 32 bytes of hex", 64, nonce.raw.length)
        assertEquals("hash is SHA-256 hex", 64, nonce.hashed.length)
        assertNotEquals("the raw nonce must never be what Google echoes", nonce.raw, nonce.hashed)
        assertEquals(GoogleSignInNonceFactory.sha256Hex(nonce.raw), nonce.hashed)
        assertTrue(nonce.raw.matches(Regex("[0-9a-f]{64}")))
    }

    @Test
    fun `sha256Hex matches the published digest, so Supabase's own check will agree`() {
        // The standard SHA-256("abc") test vector.
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            GoogleSignInNonceFactory.sha256Hex("abc"),
        )
    }

    @Test
    fun `every sign-in attempt gets its own nonce, so a token cannot be replayed`() {
        val random = SecureRandom()
        val nonces = (1..50).map { GoogleSignInNonceFactory.generate(random).raw }

        assertEquals("all 50 nonces must be distinct", 50, nonces.toSet().size)
    }

    @Test
    fun `the request Retrofit sends is the Supabase id_token grant`() = runTest {
        var sent: Request? = null
        var body = ""
        val client = OkHttpClient.Builder()
            .addInterceptor(
                Interceptor { chain ->
                    sent = chain.request()
                    body = okio.Buffer().also { chain.request().body?.writeTo(it) }.readUtf8()
                    okhttp3.Response.Builder()
                        .request(chain.request())
                        .protocol(Protocol.HTTP_1_1)
                        .code(200)
                        .message("OK")
                        .body(
                            """{"access_token":"a","refresh_token":"r","expires_in":3600,"token_type":"bearer","user":{"id":"u"}}"""
                                .toResponseBody("application/json".toMediaType()),
                        )
                        .build()
                },
            )
            .build()
        val api = Retrofit.Builder()
            .baseUrl("https://project.supabase.example/")
            .client(client)
            // The app's own converter, so this proves the shape Proplyst really puts on the wire.
            .addConverterFactory(
                SerializationConverterFactory.create(
                    Json { ignoreUnknownKeys = true },
                    "application/json".toMediaType(),
                ),
            )
            .build()
            .create(SupabaseAuthApi::class.java)

        api.signInWithIdToken(body = IdTokenSignInRequest(provider = "google", idToken = "google-id-token", nonce = "raw-nonce"))

        assertEquals("POST", sent!!.method)
        assertEquals("/auth/v1/token", sent!!.url.encodedPath)
        assertEquals("id_token", sent!!.url.queryParameter("grant_type"))
        assertTrue("the provider must be google", body.contains("\"provider\":\"google\""))
        assertTrue("the id token is sent as id_token", body.contains("\"id_token\":\"google-id-token\""))
        assertTrue("the RAW nonce goes to Supabase", body.contains("\"nonce\":\"raw-nonce\""))
    }

    @Test
    fun `a Google sign-in persists its session exactly like an email sign-in`() = runTest {
        val authApi = mockk<SupabaseAuthApi>()
        val request = slot<IdTokenSignInRequest>()
        coEvery { authApi.signInWithIdToken(any(), capture(request)) } returns Response.success(session())
        val sessionManager = mockk<SessionManager>(relaxed = true)
        val repo = repository(authApi, sessionManager)

        val result = repo.signInWithGoogle(idToken = "google-id-token", rawNonce = "raw-nonce")

        assertTrue(result.isSuccess)
        assertEquals("google", request.captured.provider)
        assertEquals("google-id-token", request.captured.idToken)
        assertEquals("raw-nonce", request.captured.nonce)
        verify { sessionManager.saveSession("access-token", "refresh-token", "user-1") }
        verify { sessionManager.saveEmail("person@example.com") }
        assertTrue(repo.authState.value is AuthState.Authenticated)
        assertEquals("user-1", (repo.authState.value as AuthState.Authenticated).userId)
    }

    @Test
    fun `a rejected Google token leaves the app signed out and stores nothing`() = runTest {
        val authApi = mockk<SupabaseAuthApi>()
        coEvery { authApi.signInWithIdToken(any(), any()) } returns
            Response.error(400, "".toResponseBody(null))
        val sessionManager = mockk<SessionManager>(relaxed = true)
        val repo = repository(authApi, sessionManager)

        val result = repo.signInWithGoogle(idToken = "bad-token", rawNonce = "raw-nonce")

        assertTrue(result.isFailure)
        assertTrue("the failure must name the method", result.exceptionOrNull()!!.message!!.contains("Google sign-in failed"))
        verify(exactly = 0) { sessionManager.saveSession(any(), any(), any()) }
        assertFalse(repo.authState.value is AuthState.Authenticated)
    }

    @Test
    fun `a network failure during Google sign-in is reported, not swallowed`() = runTest {
        val authApi = mockk<SupabaseAuthApi>()
        coEvery { authApi.signInWithIdToken(any(), any()) } throws java.io.IOException("offline")
        val sessionManager = mockk<SessionManager>(relaxed = true)
        val repo = repository(authApi, sessionManager)

        val result = repo.signInWithGoogle(idToken = "google-id-token", rawNonce = "raw-nonce")

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is java.io.IOException)
        coVerify(exactly = 0) { sessionManager.saveSession(any(), any(), any()) }
    }

    @Test
    fun `a Google account with no email still signs in`() = runTest {
        val authApi = mockk<SupabaseAuthApi>()
        coEvery { authApi.signInWithIdToken(any(), any()) } returns Response.success(session(email = null))
        val sessionManager = mockk<SessionManager>(relaxed = true)
        val repo = repository(authApi, sessionManager)

        val result = repo.signInWithGoogle(idToken = "google-id-token", rawNonce = "raw-nonce")

        assertTrue(result.isSuccess)
        verify { sessionManager.saveSession("access-token", "refresh-token", "user-1") }
        verify(exactly = 0) { sessionManager.saveEmail(any()) }
    }
}
