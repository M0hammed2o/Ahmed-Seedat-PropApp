# PropertyVault — Native Android

Real native Kotlin/Jetpack Compose application, per `NATIVE_ANDROID_SPEC.md`,
`MOBILE_ARCHITECTURE_DECISION.md`, and `DESIGN_SYSTEM.md`. A separate project from
`apps/mobile` (Expo/React Native, reference-only during migration — never converted, per
`MOBILE_ARCHITECTURE_DECISION.md` §4: "the existing app is a working spec, not a starting point
to fork").

## Toolchain status

**Verified 2026-08-01** (real command output for every line below — see `WORKLOG.md` for the full
transcript; nothing here is claimed without it). **Update this section, and `TASKS.md`/
`WORKLOG.md`, whenever the toolchain status actually changes; do not let it go stale.**

| Component | Status | Detail |
| --- | --- | --- |
| Android Studio | Installed | `AI-261.26222.65.2613.15948027`, `C:\Program Files\Android\Android Studio` |
| Android SDK | Installed | `C:\Users\<user>\AppData\Local\Android\Sdk` |
| SDK platforms | `android-34` only | `android-35` platform not installed (only its system image is) -- `compileSdk`/`targetSdk` set to 34 to match what's actually present |
| SDK Build-Tools | `34.0.0`, `35.0.0` | |
| Platform-Tools (`adb`) | `37.0.1` | confirmed working, daemon starts, `adb devices` lists the emulator |
| Emulator | `37.1.11` | confirmed working |
| System images | `android-35;google_apis_playstore;x86_64` only | used for the AVD below; running an API-34-targeted app on an API-35 image is normal Android backward compatibility, not a mismatch that matters |
| `cmdline-tools` | **Missing, installed this session** | not present initially (no `sdkmanager`/`avdmanager` anywhere in the SDK) -- downloaded `commandlinetools-win-11076708_latest.zip` from Google's repository and installed to `cmdline-tools/latest/` |
| AVD | **Missing, created this session** | `PropertyVault_Pixel7_API35` (Pixel 7 profile -- no Pixel 8 profile exists in this cmdline-tools version's device list; Pixel 7 is the newest available and a reasonable "recent Pixel profile") |
| Bundled JDK (Android Studio JBR) | OpenJDK 25.0.2 -- **incompatible with Gradle 8.7** | Real, reproduced failure: `java.lang.IllegalArgumentException: 25.0.2` inside Gradle 8.7's bundled Kotlin DSL compiler's `JavaVersion.parse()`, hit immediately on any Gradle invocation once `settings.gradle.kts`/`build.gradle.kts` exist in the project (they require Kotlin DSL evaluation). Confirmed via `--stacktrace`, not guessed. |
| JDK actually used for Gradle | **Eclipse Temurin 21.0.5+11, installed this session** | downloaded from `adoptium.net`'s GitHub releases, extracted to `C:\Users\<user>\jdk-temurin-21\jdk-21.0.5+11`. Wired via `org.gradle.java.home` in `~/.gradle/gradle.properties` (Gradle's own user-config file -- **not** a system-wide `JAVA_HOME`, per "prefer project-local configuration... do not modify system-wide environment variables unnecessarily") |
| `JAVA_HOME` / `ANDROID_HOME` / `ANDROID_SDK_ROOT` | Not set at OS/user level | confirmed via `$env:` checks; not modified by this session (see JDK row above for how Gradle finds a JDK instead) |
| Gradle | **Not on PATH, wrapper generated this session** | downloaded `gradle-8.7-bin.zip` once, used only to bootstrap `./gradlew`/`gradle-wrapper.jar` in this project via `gradle wrapper --gradle-version 8.7` (run under Temurin 21, not the incompatible JBR) -- the checked-in wrapper is what every future build should use, not this bootstrap step |
| `gradlew assembleDebug` | **BUILD SUCCESSFUL** | real 20.6 MB `app-debug.apk` produced, confirmed on disk |
| `gradlew testDebugUnitTest` | **7/7 tests passed** | 0 failures, 0 errors (both test classes) |
| `gradlew lintDebug` | **0 errors, 55 warnings** | typical for a first vertical slice (missing monochrome launcher icon variant, etc.) |
| Install + launch on `PropertyVault_Pixel7_API35` | **Confirmed via `adb install`/`am start`/`logcat`/screenshots** | `ActivityTaskManager: Displayed com.propertyvault.app/.MainActivity`, no `FATAL`/crash in logcat; sign-in screen, owner bottom-nav (Dashboard/Properties tabs), Properties list (mock fixture data), Property detail (back-navigation working), light mode, and dark mode (`adb shell cmd uimode night yes`) all visually confirmed via real screenshots pulled off the emulator |

Two real, unrelated bugs found and fixed while getting this far (full narrative in `DECISIONS.md`
2026-08-01):
1. Android XML comments cannot contain `--` (this session's own comment style throughout every
   other language) -- every `.xml` file's comments were rewritten to avoid it after a real
   `mergeDebugResources` failure pointed at the exact line.
2. `com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter:1.0.0` resolved correctly
   on both the debug compile and runtime classpaths (confirmed via `gradlew app:dependencies`) but
   produced a persistent, unexplained "Unresolved reference" from the Kotlin compiler that
   survived a full clean, daemon restart, and `--stacktrace` investigation. Replaced with a
   ~30-line hand-rolled `Converter.Factory` (`data/network/SerializationConverterFactory.kt`)
   using `kotlinx.serialization`'s own public `serializer(java.lang.reflect.Type)` JVM-reflection
   bridge, removing the dependency entirely rather than continuing to debug an opaque toolchain
   issue. If a future session isolates the real cause, reintroducing the library is a one-file
   revert.

## Setup

1. Copy `local.properties.example` → `local.properties` and fill in real values (never commit this
   file — it's gitignored).
2. Android Studio should auto-detect the SDK; if building from the command line, ensure
   `local.properties`'s `sdk.dir` points at your SDK, and `JAVA_HOME` (or `org.gradle.java.home`
   in `gradle.properties`, project-local, not a system-wide env var) points at a JDK Gradle/AGP
   actually support — see the toolchain status note above for which JDK that turned out to be in
   this environment.
3. `./gradlew assembleDebug` to build, or open the project in Android Studio.

## Why plain REST, not the `supabase-kt` SDK

This first vertical slice hand-models the two Supabase surfaces it needs (`SupabaseAuthApi.kt` for
`POST /auth/v1/token`, `PostgrestApi.kt` for RLS-protected reads) as plain Retrofit interfaces,
rather than pulling in `supabase-kt`. Both are simple, well-documented REST endpoints — Supabase
Auth's password grant and PostgREST's query-param filtering — and hand-modeling them avoids a
second dependency-version matrix (supabase-kt's own Ktor/coroutines version requirements) on top
of the already-real risk in getting AGP/Kotlin/Compose-Compiler/Gradle versions to align in an
environment being verified for the first time. `supabase-kt` is a reasonable upgrade path once
this foundation is proven to actually build and run — not ruled out, just not the first move.

## Why `apps/android`, not `apps/mobile/android`

A genuinely separate, from-scratch native project (`ARCHITECTURE.md`'s `apps/android` target),
never generated from or replacing `apps/mobile` (Expo) — per Mohammed's explicit instruction not
to convert the Expo project into the native Android app. `apps/mobile` remains exactly as it is,
untouched, reference-only.

## Architecture

- **UI**: Jetpack Compose, Material 3 (no Material You dynamic colour — `NATIVE_ANDROID_SPEC.md`
  §5, a deliberate brand-consistency choice, not an oversight).
- **Navigation**: Navigation Compose, adaptive three-tier pattern for larger screens
  (`NATIVE_ANDROID_SPEC.md` §14) — not yet implemented in this first slice (phone-only bottom nav
  today), tracked as a follow-up once a tablet/foldable pass is actually done.
- **State management**: MVVM, `ViewModel` + `StateFlow`, Hilt for DI.
- **Networking**: Retrofit + OkHttp + kotlinx.serialization.
- **Local storage**: Room (read-through cache for Properties), `EncryptedSharedPreferences`
  (session token, Keystore-backed).
- **Auth**: password sign-in against Supabase Auth's REST API directly; session token stored
  encrypted, device-only (`android:allowBackup="false"`, matching iOS's Keychain
  `ThisDeviceOnly` guarantee). Biometric re-entry gate is scaffolded as a foundation
  (`androidx.biometric` dependency present) but not yet wired to an actual `BiometricPrompt` call
  — tracked as a follow-up, not claimed done.
- **Offline**: Room-backed read-through cache with a visible "showing cached data" banner on
  fetch failure (`NATIVE_ANDROID_SPEC.md` §7/§8). No write-queue yet (Maintenance ticket
  submission, the one write path`MOBILE_ARCHITECTURE_DECISION.md` §9 scopes for V1 offline
  support) — not built in this first vertical slice, which is read-only (Properties list/detail).

## What this first vertical slice includes

Authentication shell (splash/session-restore, sign-in, sign-out plumbing) + Owner portal
(bottom nav shell, Dashboard placeholder, Properties list, Property detail) with loading/empty/
error states and a cached-data-banner foundation. Everything else in `NATIVE_ANDROID_SPEC.md`
(Units, Tenants, Leases, Maintenance, the remaining owner tabs, the Tenant portal) is
specification only until its own vertical slice is built the same way, one module at a time
(`TASKS.md` M22).
