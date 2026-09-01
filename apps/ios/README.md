# Proplyst — Native iOS (source-only, no Xcode project)

**Status: MACOS/XCODE REQUIRED.** This directory contains reviewable Swift source only. There is
no `.xcodeproj`/`.xcworkspace`, no `Package.swift` Xcode target, and nothing here has been
compiled, run in a simulator, or verified on a device — this session ran on Windows with no
Xcode/macOS/Swift toolchain available. A hand-authored `.pbxproj` was deliberately NOT created:
Xcode's project file format is not meant to be hand-edited, and a blind one would be unverifiable
and likely broken, which is worse than no scaffold at all.

## What this is

Per `NATIVE_IOS_SPEC.md` (the implementation-ready screen/architecture spec, extended by that
document's own §16 addendum this pass) and `MOBILE_ARCHITECTURE_DECISION.md`, this is the
backend-contract layer safely reviewable without a compiler: domain models, `Codable` DTOs, the
API error model, the networking client (session/refresh strategy), Keychain session storage,
biometric-lock scaffolding, and repository protocols — deliberately NOT SwiftUI `View` files,
which are much harder to reason about correctly without Xcode Previews and a real compiler to
catch even basic errors.

Every domain model and DTO mirrors `apps/android`'s own data layer field-for-field (the one native
app that has actually been built, tested — 171 unit tests passing — and verified this pass) and,
transitively, `packages/types`/`packages/validation`'s shapes — never invented independently. See
`NATIVE_IOS_SPEC.md` §16.1 for the explicit scope reconciliation: this V1 targets Android's
*actual shipped* capability set, not this spec document's own more ambitious original vision.

## Bringing this into a real Xcode project

1. Create a new iOS App target in Xcode (Swift, SwiftUI lifecycle, iOS 17+ per
   `NATIVE_IOS_SPEC.md` §7's `@Observable` choice).
2. Add this directory's `Sources/Proplyst/` tree to the target (drag into Xcode, or reference via
   a local Swift Package).
3. Fix whatever the compiler flags — this source was written carefully against known-stable Swift/
   Foundation/Security-framework APIs, but has never actually been compiled; treat the first build
   as the real first verification pass, not a formality.
4. Wire `Info.plist` (bundle identifier, `NSFaceIDUsageDescription` for biometric auth,
   Associated Domains entitlement for Universal Links per `NATIVE_IOS_SPEC.md` §12).
5. Continue with the SwiftUI `View` layer per `NATIVE_IOS_SPEC.md` §2-§4's screen hierarchy —
   deliberately not attempted here.

## What's here

```
Sources/Proplyst/
  Domain/          Plain value types: Property, Tenant, Lease, MaintenanceTicket, PaymentReport,
                    AppNotification, Announcement, AuthState/OrgMembership/TenancyMembership.
  Networking/       APIError (mirrors the server's { error: { code, message } } shape and
                    Android's WebApiErrorBody), APIClient (URLSession actor, bearer auth,
                    one-retry-max refresh-on-401 matching Android's TokenAuthenticator exactly).
  Auth/            KeychainSessionStore (kSecAttrAccessibleWhenUnlockedThisDeviceOnly, the direct
                    equivalent of Android's Keystore-backed EncryptedSharedPreferences),
                    AuthRepository protocol + a deterministic mock (never mixed with a real
                    implementation, matching every existing repository split in this codebase).
  Repositories/     Protocol definitions only (PropertiesRepository, TenantsRepository, etc.) --
                    real URLSession-backed implementations are Xcode-verification work, not
                    attempted blind.
  Biometric/        BiometricAuthenticator (LocalAuthentication wrapper) + BiometricLockState
                    (the lifecycle-driven gate, mirroring Android's BiometricGateViewModel).
  DesignTokens/     ColorTokens/Spacing/TypeScale stub matching NATIVE_IOS_SPEC.md §15's shared
                    token format decision -- the values themselves are NOT filled in (that needs
                    the still-unbuilt tokens.ts JSON export step §15 itself flags as future work).
```

## Explicitly not done here

- No SwiftUI `View`/screen implementations.
- No `Package.swift`/Xcode project of any kind.
- No signing/provisioning — that's an owner action requiring an Apple Developer account, never
  something to fabricate.
- No claim of compile success, simulator success, or device success. `IOS BUILD VERIFIED: NO` and
  `MACOS/XCODE REQUIRED: YES` until a real Xcode environment actually builds this.
