import Foundation

/// Mirrors the server's `{ error: { code, message } }` JSON error-body shape (every
/// `apps/admin/app/api/v1/**` route) and `apps/android`'s `WebApiErrorBody`/`WebApiErrorDetail`
/// DTOs exactly.
struct WebAPIErrorBody: Codable, Sendable {
    let error: WebAPIErrorDetail?
}

struct WebAPIErrorDetail: Codable, Sendable {
    let code: String?
    let message: String?
}

/// The error type every repository throws. `.server` carries the SERVER's own user-facing
/// message verbatim when the response body parsed as `WebAPIErrorBody` -- never a different,
/// invented message, and never leaks internal provider/infrastructure terminology, since it only
/// ever repeats back exactly what the server itself chose to say (`NATIVE_IOS_SPEC.md` §16.2 --
/// this is the mechanism that correctly surfaces scanUploadOrRespond()'s professional 503 wording,
/// "Document uploads are temporarily unavailable while secure file scanning is being
/// configured.", without this app needing to know anything about malware scanning at all).
enum APIError: Error, Equatable, Sendable {
    /// A non-2xx response whose body parsed into a server error message.
    case server(statusCode: Int, message: String)
    /// A non-2xx response with no parseable error body -- falls back to a generic,
    /// status-code-only message, never a raw/unparsed body dumped to the user.
    case unexpectedStatus(statusCode: Int)
    /// The caller has no valid session (never attempted, or a refresh failed and
    /// AuthCoordinator has already flipped to signed-out).
    case unauthenticated
    /// A transport-level failure (no connectivity, timeout, TLS error, etc.) -- distinct from
    /// `.server`/`.unexpectedStatus` so callers can offer a "check your connection" retry
    /// affordance rather than a generic error, mirroring every existing Android repository's own
    /// `catch (e: Exception) { ... "check your connection" }` fallback branch.
    case transport(underlying: String)
    /// The response body did not decode into the expected `Codable` type -- a client/server
    /// contract drift, never silently swallowed as a generic failure.
    case decodingFailed(underlying: String)

    /// User-facing text -- exactly what a `Text`/banner/toast should show. Never exposes a raw
    /// exception description or internal provider name.
    var userMessage: String {
        switch self {
        case .server(_, let message):
            return message
        case .unexpectedStatus(let statusCode):
            return "Something went wrong (\(statusCode)). Please try again."
        case .unauthenticated:
            return "Please sign in again."
        case .transport:
            return "Check your connection and try again."
        case .decodingFailed:
            return "Something went wrong. Please try again."
        }
    }
}
