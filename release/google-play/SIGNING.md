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
SHA-256 from *Play Console → Setup → App signing* — **not** the upload SHA-256 above. Publish it as:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "za.co.proplyst.app",
    "sha256_cert_fingerprints": ["<Play app signing SHA-256>"]
  }
}]
```

App Links are a post-launch improvement, not a release blocker — the app works fully without them.
