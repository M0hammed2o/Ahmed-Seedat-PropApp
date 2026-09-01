import Foundation
import Observation

/// `NATIVE_IOS_SPEC.md` §13 / §16.4: "fingerprint/face unlock gate on app foreground-from-
/// background, configurable in Settings." Mirrors `apps/android`'s `BiometricGateViewModel`
/// exactly, including the lesson learned live building that Android equivalent: `handlePhase(_:)`
/// is driven EXTERNALLY (the root `View` calls it from `.onChange(of: scenePhase)`), never fetched
/// internally via some global "current scene phase" -- this is what keeps it trivially unit-
/// testable (call `handlePhase(.background)` then `.active` directly, no `UIApplication`/scene
/// machinery needed in a test target) and mirrors Android's own fix (a directly-fetched
/// `ProcessLifecycleOwner.get()` inside a ViewModel's `init` was confirmed, live, to throw in a
/// pure-unit-test environment -- injecting/driving the signal externally instead avoided the
/// identical class of problem here before it could ever occur).
@Observable
final class BiometricLockState {
    private(set) var locked: Bool = false
    private(set) var lockEnabled: Bool

    private var wasBackgrounded = false
    private let preferences: BiometricLockPreferences

    init(preferences: BiometricLockPreferences) {
        self.preferences = preferences
        self.lockEnabled = preferences.isEnabled()
    }

    /// Call from the root `View`'s `.onChange(of: scenePhase) { _, newPhase in state.handlePhase(newPhase) }`.
    /// Values mirror `SwiftUI.ScenePhase` (`.active`, `.inactive`, `.background`) -- expressed as
    /// a small local enum here rather than importing SwiftUI into this otherwise UI-framework-free
    /// file, keeping this class reviewable/testable independent of a SwiftUI target.
    enum Phase: Sendable {
        case active
        case inactive
        case background
    }

    func handlePhase(_ phase: Phase) {
        switch phase {
        case .background:
            if lockEnabled { wasBackgrounded = true }
        case .active:
            // Re-checked live, not cached from when the toggle was turned on -- hardware/
            // enrollment can change while the app was backgrounded (e.g. the user removed Face ID
            // enrollment in system Settings). Never trap the user behind a gate that can no
            // longer be passed: skip locking this time rather than requiring biometrics that no
            // longer exist. The toggle itself is left on, since availability can just as easily
            // come back.
            if wasBackgrounded && lockEnabled && checkBiometricAvailability() == .available {
                locked = true
            }
            wasBackgrounded = false
        case .inactive:
            break
        }
    }

    func setLockEnabled(_ enabled: Bool) {
        preferences.setEnabled(enabled)
        lockEnabled = enabled
        if !enabled { locked = false }
    }

    func unlock() {
        locked = false
    }
}

/// Biometric app-lock ON/OFF toggle persistence -- mirrors `apps/android`'s
/// `BiometricLockPreferences` (plain `UserDefaults`, not Keychain -- this stores a UI preference,
/// not a credential; the actual session tokens `KeychainSessionStore` guards remain untouched by
/// anything in this file).
final class BiometricLockPreferences: @unchecked Sendable {
    private let defaults: UserDefaults
    private let key = "biometric_lock_enabled"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func isEnabled() -> Bool { defaults.bool(forKey: key) }

    func setEnabled(_ enabled: Bool) {
        defaults.set(enabled, forKey: key)
    }
}
