import Foundation
import Security

/// Session token storage -- `NATIVE_IOS_SPEC.md` §13: Keychain with
/// `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` (never synced to iCloud Keychain, since a
/// session token should not silently propagate to a second device), the direct iOS equivalent of
/// `apps/android`'s Keystore-backed `EncryptedSharedPreferences` (`SessionManager.kt`) -- same
/// "device-only, never synced" guarantee, different platform mechanism.
///
/// A thin, dependency-free wrapper around the Security framework's C API (no third-party Keychain
/// library) -- deliberately minimal surface (`save`/`get`/`clear` only, mirroring
/// `SessionManager`'s own three-method shape) so it stays easy to review without a compiler.
final class KeychainSessionStore: @unchecked Sendable {
    private let service = "za.co.proplyst.app.session"
    private let accessTokenKey = "access_token"
    private let refreshTokenKey = "refresh_token"
    private let userIdKey = "user_id"

    func saveSession(accessToken: String, refreshToken: String, userId: String) {
        set(accessTokenKey, accessToken)
        set(refreshTokenKey, refreshToken)
        set(userIdKey, userId)
    }

    func getAccessToken() -> String? { get(accessTokenKey) }
    func getRefreshToken() -> String? { get(refreshTokenKey) }
    func getUserId() -> String? { get(userIdKey) }

    func clear() {
        for key in [accessTokenKey, refreshTokenKey, userIdKey] {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: key,
            ]
            SecItemDelete(query as CFDictionary)
        }
    }

    private func set(_ key: String, _ value: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        // Delete-then-add rather than SecItemUpdate -- simpler to reason about correctly without
        // a compiler/test run, at the cost of a marginally less atomic write for what is a small,
        // infrequently-written value (a session token save, not a hot path).
        SecItemDelete(query as CFDictionary)
        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        SecItemAdd(attributes as CFDictionary, nil)
    }

    private func get(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
