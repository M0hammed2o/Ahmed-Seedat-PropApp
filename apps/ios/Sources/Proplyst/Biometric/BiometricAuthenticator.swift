import Foundation
import LocalAuthentication

/// `NATIVE_IOS_SPEC.md` §13 / §16.4: `LocalAuthentication` framework, Face ID/Touch ID with the
/// system passcode fallback (`LAPolicy.deviceOwnerAuthentication`, never a custom PIN screen --
/// avoids maintaining a second credential system `SECURITY.md` would need to separately govern).
/// Client-side-only app-unlock gate -- success here never touches `KeychainSessionStore` or
/// `AuthRepository`, and never substitutes for or extends the JWT session's own expiry/refresh
/// cycle, exactly matching `apps/android`'s `BiometricAuthenticator.kt`.
enum BiometricAvailability: Sendable {
    case available
    case noHardware
    case notEnrolled
    case unavailable
}

func checkBiometricAvailability() -> BiometricAvailability {
    let context = LAContext()
    var error: NSError?
    let canEvaluate = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    if canEvaluate { return .available }
    guard let error else { return .unavailable }
    switch error.code {
    case LAError.biometryNotAvailable.rawValue:
        return .noHardware
    case LAError.biometryNotEnrolled.rawValue, LAError.passcodeNotSet.rawValue:
        return .notEnrolled
    default:
        return .unavailable
    }
}

enum BiometricResult: Sendable {
    case success
    case cancelled
    case failed(message: String)
}

/// Bridges `LAContext`'s callback-based `evaluatePolicy` to `async/await` -- the direct Swift
/// equivalent of `apps/android`'s `suspendCancellableCoroutine`-wrapped `BiometricPrompt` call.
func authenticateWithBiometrics(reason: String) async -> BiometricResult {
    let context = LAContext()
    return await withCheckedContinuation { continuation in
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, error in
            if success {
                continuation.resume(returning: .success)
                return
            }
            guard let laError = error as? LAError else {
                continuation.resume(returning: .failed(message: error?.localizedDescription ?? "Authentication failed."))
                return
            }
            switch laError.code {
            case .userCancel, .systemCancel, .appCancel, .userFallback:
                continuation.resume(returning: .cancelled)
            default:
                continuation.resume(returning: .failed(message: laError.localizedDescription))
            }
        }
    }
}
