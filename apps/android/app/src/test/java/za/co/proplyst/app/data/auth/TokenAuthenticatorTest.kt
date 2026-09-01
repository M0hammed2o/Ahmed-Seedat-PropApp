package za.co.proplyst.app.data.auth

import za.co.proplyst.app.data.network.SupabaseAuthApi
import za.co.proplyst.app.data.network.dto.AuthSessionResponse
import za.co.proplyst.app.data.network.dto.AuthUserDto
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import retrofit2.Response as RetrofitResponse
import javax.inject.Provider
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Android V1 final gap-closure pass (WORKLOG.md this date), Phase 2. Real okhttp3.Response/
 * Request objects (not mocked) -- Authenticator.authenticate() is OkHttp's own contract, and the
 * behaviour under test (response chain length, header inspection) only means something against
 * real OkHttp types.
 *
 * Auth/session hardening pass (WORKLOG.md this date): TokenAuthenticator now takes a third
 * Provider<AuthRepository> (same lazy-Provider trick as authApiProvider, and for the identical
 * cycle-breaking reason) so an unrecoverable refresh failure can flip AuthState to
 * Unauthenticated immediately via forceSignOutLocally(), not just clear SessionManager's storage
 * -- every TokenAuthenticator(...) construction below passes a mocked AuthRepository accordingly. */
class TokenAuthenticatorTest {

    private fun request(token: String?): Request {
        val builder = Request.Builder().url("https://example.test/api/v1/whatever")
        if (token != null) builder.header("Authorization", "Bearer $token")
        return builder.build()
    }

    private fun response(req: Request, prior: Response? = null): Response = Response.Builder()
        .request(req)
        .protocol(Protocol.HTTP_1_1)
        .code(401)
        .message("Unauthorized")
        .body("".toResponseBody(null))
        .apply { if (prior != null) priorResponse(prior) }
        .build()

    private fun session(): AuthSessionResponse = AuthSessionResponse(
        accessToken = "new-access-token",
        refreshToken = "new-refresh-token",
        expiresIn = 3600,
        tokenType = "bearer",
        user = AuthUserDto(id = "user-1", email = "tenant@example.test"),
    )

    @Test
    fun `successful refresh saves the new session and retries with the new token`() = runTest {
        val sessionManager = mockk<SessionManager>(relaxed = true)
        every { sessionManager.getAccessToken() } returns "old-access-token"
        every { sessionManager.getRefreshToken() } returns "old-refresh-token"

        val authApi = mockk<SupabaseAuthApi>()
        coEvery { authApi.refreshSession(body = any()) } returns RetrofitResponse.success(session())
        val authRepository = mockk<AuthRepository>(relaxed = true)

        val authenticator = TokenAuthenticator(sessionManager, Provider { authApi }, Provider { authRepository })
        val failedRequest = request("old-access-token")

        val result = authenticator.authenticate(null, response(failedRequest))

        assertEquals("Bearer new-access-token", result?.header("Authorization"))
        io.mockk.verify { sessionManager.saveSession("new-access-token", "new-refresh-token", "user-1") }
        io.mockk.verify(exactly = 0) { authRepository.forceSignOutLocally() }
    }

    @Test
    fun `refresh failure (rejected by server) force-signs-out locally and gives up`() = runTest {
        val sessionManager = mockk<SessionManager>(relaxed = true)
        every { sessionManager.getAccessToken() } returns "old-access-token"
        every { sessionManager.getRefreshToken() } returns "old-refresh-token"

        val authApi = mockk<SupabaseAuthApi>()
        coEvery { authApi.refreshSession(body = any()) } returns
            RetrofitResponse.error(401, "{}".toResponseBody(null))
        val authRepository = mockk<AuthRepository>(relaxed = true)

        val authenticator = TokenAuthenticator(sessionManager, Provider { authApi }, Provider { authRepository })
        val result = authenticator.authenticate(null, response(request("old-access-token")))

        assertNull(result)
        // forceSignOutLocally() (not a raw sessionManager.clear()) is what actually flips AuthState
        // to Unauthenticated for a screen that's currently observing it -- see AuthRepository's own
        // doc comment for why a plain SessionManager.clear() alone isn't enough here.
        io.mockk.verify { authRepository.forceSignOutLocally() }
    }

    @Test
    fun `no refresh token on file gives up without calling the network`() = runTest {
        val sessionManager = mockk<SessionManager>(relaxed = true)
        every { sessionManager.getAccessToken() } returns "old-access-token"
        every { sessionManager.getRefreshToken() } returns null

        val authApi = mockk<SupabaseAuthApi>()
        val authRepository = mockk<AuthRepository>(relaxed = true)

        val authenticator = TokenAuthenticator(sessionManager, Provider { authApi }, Provider { authRepository })
        val result = authenticator.authenticate(null, response(request("old-access-token")))

        assertNull(result)
        io.mockk.coVerify(exactly = 0) { authApi.refreshSession(body = any()) }
    }

    @Test
    fun `never retries a request that has already been retried once (no infinite loop)`() = runTest {
        val sessionManager = mockk<SessionManager>(relaxed = true)
        val authApi = mockk<SupabaseAuthApi>()
        val authRepository = mockk<AuthRepository>(relaxed = true)

        val authenticator = TokenAuthenticator(sessionManager, Provider { authApi }, Provider { authRepository })
        // OkHttp requires a priorResponse's body to already be null (it represents an already-
        // consumed response, same constraint real redirect/auth-challenge chains have) --
        // built without .body(...), unlike every other response() in this file.
        val firstAttempt = Response.Builder()
            .request(request("old-access-token"))
            .protocol(Protocol.HTTP_1_1)
            .code(401)
            .message("Unauthorized")
            .build()
        val secondAttempt = response(request("new-access-token"), prior = firstAttempt)

        val result = authenticator.authenticate(null, secondAttempt)

        assertNull(result)
        io.mockk.coVerify(exactly = 0) { authApi.refreshSession(body = any()) }
    }

    @Test
    fun `a concurrent caller reuses the token a racing refresh already stored, instead of refreshing twice`() = runTest {
        val sessionManager = mockk<SessionManager>(relaxed = true)
        // Simulates the moment right after another thread's refresh already completed and saved a
        // new token -- SessionManager now returns a DIFFERENT token than the one this failed
        // request was sent with.
        every { sessionManager.getAccessToken() } returns "already-refreshed-token"
        every { sessionManager.getRefreshToken() } returns "old-refresh-token"

        val authApi = mockk<SupabaseAuthApi>()
        val authRepository = mockk<AuthRepository>(relaxed = true)

        val authenticator = TokenAuthenticator(sessionManager, Provider { authApi }, Provider { authRepository })
        val result = authenticator.authenticate(null, response(request("old-access-token")))

        assertEquals("Bearer already-refreshed-token", result?.header("Authorization"))
        io.mockk.coVerify(exactly = 0) { authApi.refreshSession(body = any()) }
    }

    /** A minimal, genuinely stateful fake -- mockk's `returnsMany` can't express "return whatever
     * the last saveSession() call stored," and that statefulness is exactly what this test needs
     * to prove: the SECOND racing thread must observe the FIRST thread's saved token, not a fixed
     * canned value, for the "reuse a racing refresh" branch to mean anything under real
     * concurrency (as opposed to the single-threaded `runTest` cases above, which prove the branch
     * logic itself but run on one thread by construction). */
    private class FakeSessionManager(initialAccessToken: String) {
        @Volatile var accessToken: String? = initialAccessToken
        @Volatile var refreshToken: String? = "old-refresh-token"

        fun asSessionManager(): SessionManager {
            val mock = mockk<SessionManager>(relaxed = true)
            every { mock.getAccessToken() } answers { accessToken }
            every { mock.getRefreshToken() } answers { refreshToken }
            every { mock.saveSession(any(), any(), any()) } answers {
                accessToken = firstArg()
                refreshToken = secondArg()
            }
            return mock
        }
    }

    @Test
    fun `two genuinely concurrent 401s only trigger one real refresh call`() {
        val fake = FakeSessionManager(initialAccessToken = "old-access-token")
        val sessionManager = fake.asSessionManager()

        val authApi = mockk<SupabaseAuthApi>()
        val authRepository = mockk<AuthRepository>(relaxed = true)
        var refreshCallCount = 0
        coEvery { authApi.refreshSession(body = any()) } coAnswers {
            refreshCallCount++
            delay(50) // widen the race window so both threads are genuinely inside the lock together
            RetrofitResponse.success(session())
        }

        val authenticator = TokenAuthenticator(sessionManager, Provider { authApi }, Provider { authRepository })
        val pool = Executors.newFixedThreadPool(2)
        val latch = CountDownLatch(2)
        repeat(2) {
            pool.execute {
                authenticator.authenticate(null, response(request("old-access-token")))
                latch.countDown()
            }
        }
        latch.await(5, TimeUnit.SECONDS)
        pool.shutdown()

        assertEquals(1, refreshCallCount)
    }
}
