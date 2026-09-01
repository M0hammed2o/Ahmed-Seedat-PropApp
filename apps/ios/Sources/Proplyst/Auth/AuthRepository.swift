import Foundation

/// One real implementation (backed by Supabase Auth + PostgREST) and one deterministic mock,
/// never mixed -- the same split every `apps/android` repository already uses. The real
/// implementation is Xcode-verification work, deliberately not attempted blind (see this
/// directory's own README) -- `MockAuthRepository` below is complete and safe to review, since it
/// has no networking surface to get wrong.
protocol AuthRepository: Actor {
    var authState: AuthState { get }
    func restoreSession() async
    func signIn(email: String, password: String) async -> Result<Void, APIError>
    func signOut() async
    /// See `SessionInvalidationHandler` -- called by `APIClient` on an unrecoverable refresh
    /// failure, never by UI code directly.
    func forceSignOutLocally() async
}

/// Deterministic fake session -- any non-blank email/password "succeeds," matching
/// `apps/android`'s `MockAuthRepository` fixture pattern exactly. Never wired into the same
/// binding as a real implementation.
actor MockAuthRepository: AuthRepository, SessionInvalidationHandler {
    private(set) var authState: AuthState = .unauthenticated

    func restoreSession() async {
        try? await Task.sleep(nanoseconds: 300_000_000)
        // Mock mode always starts signed-out, same as a fresh real install would -- restoreSession()
        // finding no stored token is the common case this stands in for.
        authState = .unauthenticated
    }

    func signIn(email: String, password: String) async -> Result<Void, APIError> {
        try? await Task.sleep(nanoseconds: 400_000_000)
        guard !email.isEmpty, !password.isEmpty else {
            return .failure(.server(statusCode: 400, message: "Email and password are required."))
        }
        authState = .authenticated(
            userId: "demo-user-1",
            organizations: [OrgMembership(orgId: "demo-org-1", role: "principal", status: "active")],
            tenancies: []
        )
        return .success(())
    }

    func signOut() async {
        try? await Task.sleep(nanoseconds: 100_000_000)
        authState = .unauthenticated
    }

    func forceSignOutLocally() async {
        authState = .unauthenticated
    }
}
