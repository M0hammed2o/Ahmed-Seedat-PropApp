package za.co.proplyst.app.data.auth

import za.co.proplyst.app.data.network.SupabaseAuthApi
import za.co.proplyst.app.data.network.dto.RefreshTokenRequest
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import javax.inject.Inject
import javax.inject.Provider
import javax.inject.Singleton

/**
 * Android V1 final gap-closure pass (WORKLOG.md this date), Phase 2. OkHttp `Authenticator`
 * (not a plain `Interceptor`) -- OkHttp calls this automatically, exactly once per real 401, with
 * the failed request already fully formed, which is the correct hook point for "retry the failed
 * request exactly where safe" rather than pre-emptively refreshing on every call.
 *
 * `SupabaseAuthApi` is injected as a `Provider`, not directly, specifically to break a real
 * dependency cycle Dagger would otherwise reject at compile time: the OkHttpClient this
 * Authenticator attaches to is what `SupabaseAuthApi` itself is built from (NetworkModule's
 * `@Named("supabase")` Retrofit) -- a `Provider` defers the lookup until `authenticate()` actually
 * runs, after the graph is fully constructed.
 *
 * Attached to BOTH the Supabase and web OkHttpClients (NetworkModule) -- one session, one token,
 * shared refresh logic; a 401 from either host is refreshed the same way.
 */
@Singleton
class TokenAuthenticator @Inject constructor(
    private val sessionManager: SessionManager,
    private val authApiProvider: Provider<SupabaseAuthApi>,
) : Authenticator {

    private val refreshMutex = Mutex()

    override fun authenticate(route: Route?, response: Response): Request? {
        // Never retry more than once -- an already-retried request that still 401s means the
        // fresh token was itself rejected (or refresh failed outright); looping would hammer the
        // server forever on a session that is genuinely dead.
        if (responseChainLength(response) >= 2) return null

        val failedToken = response.request.header("Authorization")?.removePrefix("Bearer ")

        val newToken = runBlocking {
            refreshMutex.withLock {
                // Concurrency: if a request that raced us to this lock already refreshed the
                // token (SessionManager's stored token no longer matches what THIS request was
                // sent with), reuse that result instead of refreshing a second time -- this is
                // what prevents a "refresh storm" when several authenticated calls are in flight
                // when the token expires.
                val currentToken = sessionManager.getAccessToken()
                if (currentToken != null && currentToken != failedToken) {
                    currentToken
                } else {
                    performRefresh()
                }
            }
        } ?: return null // Refresh failed -- session already cleared inside performRefresh();
        // returning null tells OkHttp to give up and surface the original 401, which the caller
        // (ultimately RootAuthViewModel's authState, via a failed restoreSession()/API call) reads
        // as "no longer authenticated."

        return response.request.newBuilder()
            .header("Authorization", "Bearer $newToken")
            .build()
    }

    /** Real refresh against Supabase Auth. Returns null (and clears the local session) for any
     * failure -- an invalid/expired refresh token, a network error, or a malformed response are
     * all "this session cannot be recovered," never silently retried further here. */
    private suspend fun performRefresh(): String? {
        val refreshToken = sessionManager.getRefreshToken() ?: return null
        return try {
            val response = authApiProvider.get().refreshSession(body = RefreshTokenRequest(refreshToken))
            val session = response.body()
            if (!response.isSuccessful || session == null) {
                sessionManager.clear()
                return null
            }
            sessionManager.saveSession(session.accessToken, session.refreshToken, session.user.id)
            session.accessToken
        } catch (_: Exception) {
            // Deliberately does NOT clear the session on a network exception (as opposed to an
            // explicit auth failure above) -- a transient connectivity blip shouldn't sign the
            // user out; the next authenticated call simply gets the same 401-then-refresh-attempt
            // again once connectivity returns.
            null
        }
    }

    private fun responseChainLength(response: Response): Int {
        var count = 1
        var prior = response.priorResponse
        while (prior != null) {
            count++
            prior = prior.priorResponse
        }
        return count
    }
}
