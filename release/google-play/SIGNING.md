# Signing — Proplyst Android

## Upload key

Created 2026-09-10 for the first Play release. It did not exist before; the repository had no
signing configuration and every previous release build was unsigned.

| | |
|---|---|
| Keystore | `C:\Users\junsm\.proplyst-release\proplyst-upload.jks` |
| Credentials | `C:\Users\junsm\.proplyst-release\keystore.properties` |
| Alias | `proplyst-upload` |
| Algorithm | 4096-bit RSA, SHA384withRSA |
| Valid until | 2054-01-26 (Play requires at least 2033-10-22) |
| SHA-1 | `49:92:D4:8F:1D:95:9A:1A:7D:82:31:5A:F5:88:A2:C3:92:EE:BC:4E` |
| SHA-256 | `4B:F6:79:98:10:A9:86:0F:48:AC:B2:65:C5:8A:A3:38:56:BA:4D:66:65:C6:A9:35:D9:E1:4F:94:D8:3A:63:E3` |

**Both files live outside the git repository on purpose.** Nothing about the key — the keystore, the
passwords, or the path — is committed. `app/build.gradle.kts` reads the properties file by absolute
path, overridable with `KEYSTORE_PROPERTIES` in `local.properties` (which is itself gitignored).

If the properties file is missing, the release build still succeeds and simply produces an unsigned
artifact, so a clean checkout or a CI machine without the key can still verify that the app
compiles.

## Back this up today

Losing the upload key is an operational problem, not a catastrophe — with Play App Signing enabled
Google can reset it — but the reset takes days and blocks every update until it completes.

Copy **both** files to somewhere durable and private (a password manager attachment or an encrypted
drive, not a shared folder and not email):

```
C:\Users\junsm\.proplyst-release\proplyst-upload.jks
C:\Users\junsm\.proplyst-release\keystore.properties
```

Never commit them. Never send them over chat or email.

## Play App Signing

Enrol when creating the app in Play Console — it is the default and is required for new apps.

Google then holds the **app signing key** and re-signs every download. The key above becomes only
the *upload* key: it proves uploads come from you, and is not the certificate users' devices see.

**This matters for App Links.** `https://proplyst.co.za/.well-known/assetlinks.json` currently
returns `[]`, so the `autoVerify` intent filter in `AndroidManifest.xml` never verifies and Proplyst
links open in the browser instead of the app. To fix it, use the **app signing certificate**
SHA-256 from *Play Console → Setup → App signing* — **not** the upload SHA-256 above. That page
shows the certificate only after the first bundle is uploaded. Set it as
`ANDROID_APP_SHA256_FINGERPRINTS` in Render. The route then serves:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "za.co.genbridge.proplyst",
    "sha256_cert_fingerprints": ["<Play app signing SHA-256>"]
  }
}]
```

`package_name` comes from `androidPackageName` in `packages/config/src/branding.ts`. It must equal
the applicationId in `apps/android/app/build.gradle.kts` and the Play Console package,
`za.co.genbridge.proplyst`. A release-hygiene unit test checks the Gradle and branding values
agree.

App Links are a post-launch improvement, not a release blocker — the app works fully without them.

## Google Sign-In needs the same certificate registered in Google Cloud

"Continue with Google" (1.0.1) uses Android Credential Manager. Google only returns an ID token to
an app it recognises, which means an **Android OAuth client** must exist in the same Google Cloud
project as the Web client Supabase is configured with:

| Field | Value |
|---|---|
| Application type | Android |
| Package name | `za.co.genbridge.proplyst` |
| SHA-1 | The certificate of whichever build is being signed in — see the table below |

**Created 2026-09-16.** An Android OAuth client now exists in the same Google Cloud project as the
"Proplyst PWA" Web client. The Web client is what Supabase is configured with and must not be
deleted; the Android client authorises the app itself, and its client ID is never put in the app.

### Which certificate authorises which build

A Google ID token is only issued to an app whose package **and signing certificate** match a
registered Android client. The three certificates differ, so register each build you intend to sign
in from:

| Build | Signed by | SHA-1 | Needed for |
|---|---|---|---|
| Installed from Play (Internal Testing, production) | Play app signing key | `BE:B7:2B:77:7E:7B:0E:E8:DC:9C:14:D3:6D:2F:82:F0:47:E6:97:0A` | **Required** — this is what testers and users run |
| Release APK built here and sideloaded | Upload key (`proplyst-upload`) | `49:92:D4:8F:1D:95:9A:1A:7D:82:31:5A:F5:88:A2:C3:92:EE:BC:4E` | Optional — only to test a sideloaded release APK |
| Debug build from Android Studio / `assembleDebug` | `~/.android/debug.keystore` (alias `androiddebugkey`, password `android`) | `6D:0E:1C:41:E6:2C:60:E9:5D:FC:DE:32:19:B0:C8:61:B6:BF:BC:55` | Optional — only to test Google sign-in in a debug build |

All three are public certificate fingerprints, not secrets. Several SHA-1s can sit on one Android
OAuth client, or you can create one client per certificate.

No client secret is involved, and nothing is added to the app: it carries only the public Web
client ID, injected at build time from `GOOGLE_WEB_CLIENT_ID` in `local.properties` (git-ignored).
Because the app asks Google for a token whose audience is that Web client ID, **Supabase needs no
new configuration** — the same client ID already backs web Google sign-in, which is why one Google
account resolves to one Proplyst user on both.
