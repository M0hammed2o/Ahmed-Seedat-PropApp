import Foundation

/// Implemented by `AuthCoordinator` -- lets `APIClient` force a local sign-out on an
/// unrecoverable refresh failure without depending on `AuthCoordinator` directly (mirrors
/// `apps/android`'s `TokenAuthenticator` depending on `AuthRepository` only through a lazily-
/// resolved `Provider`, for the identical reason: breaking a dependency cycle between the network
/// layer and the auth layer that is itself built on the network layer).
protocol SessionInvalidationHandler: AnyObject, Sendable {
    /// Synchronous, non-network local sign-out -- the session is already known dead (an
    /// unrecoverable refresh failure); this must flip `AuthCoordinator`'s state to
    /// `.unauthenticated` immediately so a screen currently on-screen is promptly returned to
    /// sign-in, not just on the next cold launch (`NATIVE_IOS_SPEC.md` §16.3).
    func forceSignOutLocally() async
}

/// `URLSession` actor wrapper -- bearer auth header injection, JSON `Codable` decode/encode, and
/// the refresh-on-401 strategy specified in `NATIVE_IOS_SPEC.md` §16.3 (matching
/// `apps/android`'s `TokenAuthenticator.kt` exactly): at most one retry per request (a request
/// that still 401s after a fresh token means the session is genuinely dead, never loop further);
/// concurrent requests that 401 at the same time share one real refresh call via an in-flight
/// `Task`, never one refresh call each.
actor APIClient {
    private let session: URLSession
    private let baseURL: URL
    private let supabaseURL: URL
    private let supabaseAnonKey: String
    private let keychain: KeychainSessionStore
    private weak var sessionInvalidationHandler: SessionInvalidationHandler?

    /// The single in-flight refresh `Task`, if one is currently running -- awaited (not
    /// re-triggered) by any request that 401s while a refresh is already underway. This actor's
    /// own serial isolation is what makes checking-and-setting this safe without a separate lock,
    /// the Swift-concurrency equivalent of `TokenAuthenticator`'s `Mutex`.
    private var inFlightRefresh: Task<String?, Never>?

    init(
        session: URLSession = .shared,
        baseURL: URL,
        supabaseURL: URL,
        supabaseAnonKey: String,
        keychain: KeychainSessionStore,
        sessionInvalidationHandler: SessionInvalidationHandler
    ) {
        self.session = session
        self.baseURL = baseURL
        self.supabaseURL = supabaseURL
        self.supabaseAnonKey = supabaseAnonKey
        self.keychain = keychain
        self.sessionInvalidationHandler = sessionInvalidationHandler
    }

    /// Performs a request against the Next.js web API (`baseURL`), injecting the bearer token and
    /// transparently retrying once on a 401 per the refresh strategy above. `path` is relative,
    /// e.g. `"/api/v1/tenant-portal/payment-reports"`.
    func send(
        path: String,
        method: String = "GET",
        body: Data? = nil,
        contentType: String? = "application/json",
        isRetry: Bool = false
    ) async throws -> Data {
        guard let accessToken = keychain.getAccessToken() else {
            throw APIError.unauthenticated
        }
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.httpBody = body
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        if let contentType {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(underlying: error.localizedDescription)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.transport(underlying: "No HTTP response")
        }

        if httpResponse.statusCode == 401 && !isRetry {
            // Exactly one retry -- a request that still 401s after a fresh token means the fresh
            // token was itself rejected (or refresh failed outright); looping would hammer the
            // server forever on a session that is genuinely dead.
            guard let newToken = await refreshAccessToken() else {
                throw APIError.unauthenticated
            }
            _ = newToken // token already saved to Keychain by refreshAccessToken(); re-read above.
            return try await send(path: path, method: method, body: body, contentType: contentType, isRetry: true)
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw parseError(data: data, statusCode: httpResponse.statusCode)
        }

        return data
    }

    /// Convenience: decode a successful response body as `T`.
    func send<T: Decodable>(
        path: String,
        method: String = "GET",
        body: Data? = nil,
        contentType: String? = "application/json",
        as type: T.Type
    ) async throws -> T {
        let data = try await send(path: path, method: method, body: body, contentType: contentType)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decodingFailed(underlying: error.localizedDescription)
        }
    }

    private func parseError(data: Data, statusCode: Int) -> APIError {
        if let body = try? JSONDecoder().decode(WebAPIErrorBody.self, from: data),
           let message = body.error?.message {
            return .server(statusCode: statusCode, message: message)
        }
        return .unexpectedStatus(statusCode: statusCode)
    }

    /// Real refresh against Supabase Auth. Returns the new access token, or `nil` (and
    /// force-signs-out locally) for an unrecoverable failure -- an invalid/expired refresh token
    /// or a malformed response mean this session cannot be recovered. Deliberately does NOT sign
    /// out on a network/transport exception (as opposed to an explicit auth failure) -- a
    /// transient connectivity blip should not sign the user out; the next authenticated call
    /// simply gets the same 401-then-refresh-attempt again once connectivity returns. Matches
    /// `TokenAuthenticator.performRefresh()`'s exact reasoning.
    private func refreshAccessToken() async -> String? {
        if let existing = inFlightRefresh {
            return await existing.value
        }
        let task = Task<String?, Never> { [weak self] in
            await self?.performRefresh()
        }
        inFlightRefresh = task
        let result = await task.value
        inFlightRefresh = nil
        return result
    }

    private func performRefresh() async -> String? {
        guard let refreshToken = keychain.getRefreshToken() else { return nil }
        var request = URLRequest(
            url: supabaseURL.appendingPathComponent("/auth/v1/token").appending(
                queryItems: [URLQueryItem(name: "grant_type", value: "refresh_token")]
            )
        )
        request.httpMethod = "POST"
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(["refresh_token": refreshToken])

        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode),
                  let session = try? JSONDecoder().decode(SupabaseAuthSession.self, from: data)
            else {
                await sessionInvalidationHandler?.forceSignOutLocally()
                return nil
            }
            keychain.saveSession(
                accessToken: session.accessToken,
                refreshToken: session.refreshToken,
                userId: session.user.id
            )
            return session.accessToken
        } catch {
            // Transport-level failure -- session left intact, see doc comment above.
            return nil
        }
    }
}

/// Mirrors Supabase Auth's own token-response shape and `apps/android`'s `AuthSessionResponse`
/// DTO.
struct SupabaseAuthSession: Codable, Sendable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int
    let tokenType: String
    let user: SupabaseAuthUser

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
        case tokenType = "token_type"
        case user
    }
}

struct SupabaseAuthUser: Codable, Sendable {
    let id: String
    let email: String?
}
