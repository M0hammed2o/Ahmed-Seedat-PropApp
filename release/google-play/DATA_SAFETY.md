# Data safety declaration — Proplyst

Every answer below was derived by reading the code, not assumed. Where a claim depends on a
specific file, that file is named so it can be re-checked. Re-audited 12 September 2026 against
`0a22bca`.

**Scope rule that decides most of this form.** Google's Data Safety declaration covers what *your
app* collects. Proplyst's Android app is a thin client over a shared backend, and several of the
most sensitive things the *website* can store — identity numbers, payslips, bank statements, rental
applications — have no Android surface at all. Those are disclosed in the Privacy Policy, which
covers both, but they are **not** declared here, because the app does not collect them. Each one is
called out below with the evidence, so the line is auditable rather than convenient.

---

## The three questions Google asks first

**Does your app collect or share any of the required user data types?** — **Yes.**

**Is all of the user data collected by your app encrypted in transit?** — **Yes.**
Every network call goes to `https://proplyst.co.za` or `https://<project>.supabase.co`. There is no
`usesCleartextTraffic` flag and no network security config permitting cleartext; on minSdk 26+
cleartext is blocked by platform default.

**Do you provide a way for users to request that their data be deleted?** — **Yes.**
In-app: More → Account & security → Delete account. Web:
`https://proplyst.co.za/delete-account`, reachable without signing in.

---

## Data types, in Play Console order

### Personal info

| Type | Collected | Shared | Required/Optional | Purpose |
|---|---|---|---|---|
| Name | Yes | No | Optional | App functionality, Account management |
| Email address | Yes | No | **Required** | App functionality, Account management |
| User IDs | Yes | No | Required | App functionality, Account management |
| Phone number | Yes | No | Optional | App functionality |
| Address | Yes | No | Optional | App functionality |
| Race and ethnicity | No | — | — | Not collected |
| Political or religious beliefs | No | — | — | Not collected |
| Sexual orientation | No | — | — | Not collected |
| **Other info** | No | — | — | See "Government ID" below |

- **Email** is the sign-in credential (Supabase Auth) and cannot be avoided.
- **User IDs** — the Supabase `auth.users` UUID. Declare it; it is a persistent account identifier.
- **Name** is the profile display name; **phone** is optional on a member and on tenant records.
- **Address** needs care and is declared deliberately: property and unit addresses are business
  records, but a tenant's unit address is effectively a residential address of a third party, and
  the app both displays and edits it. Over-declaring here is the safer error, and it is honest.

### Financial info

| Type | Collected | Shared | Required/Optional | Purpose |
|---|---|---|---|---|
| User payment info | No | — | — | No card or bank credential is entered in the app |
| Purchase history | No | — | — | The app contains no purchase flow at all |
| Credit score | No | — | — | Not collected |
| **Other financial info** | Yes | No | Required | App functionality |

"Other financial info" is rent amounts, invoices, payments, expenses, budgets and utility costs —
the substance of the product.

**Purchase history is No, and that is now unambiguous.** The "Manage subscription" row that opened
the PayFast billing page in a browser was removed for v1.0 (`BILLING_COMPLIANCE.md`). The app sells
nothing and records no transaction of its own; an organisation subscribes on the website and an
entitled account simply signs in.

### Photos and videos

| Type | Collected | Shared | Required/Optional | Purpose |
|---|---|---|---|---|
| Photos | Yes | No | Optional | App functionality |
| Videos | No | — | — | Not collected |

Only images the user deliberately attaches: an expense receipt, a utility bill, maintenance
evidence, a meter photo. Chosen through the system camera app (`ActivityResultContracts.TakePicture`)
or Android's own photo picker (`PickVisualMedia`) — see `ui/common/EvidenceUploadPicker.kt`. The app
declares **no** `CAMERA`, `READ_MEDIA_IMAGES` or storage permission, so it never has ambient access
to the gallery.

### Audio files
**Not collected.** No microphone permission, no recording API.

### Files and docs

| Type | Collected | Shared | Required/Optional | Purpose |
|---|---|---|---|---|
| Files and docs | Yes | No | Optional | App functionality |

Documents the user attaches through the system document picker (`OpenDocument`).

### Calendar / Contacts
**Not collected.** No permission declared, no provider queried.

### App activity

| Type | Collected | Shared | Required/Optional | Purpose |
|---|---|---|---|---|
| App interactions | No | — | — | No analytics SDK records interactions |
| In-app search history | No | — | — | Not collected |
| Installed apps | No | — | — | Not queried |
| Other user-generated content | Yes | No | Optional | App functionality |
| Other actions | No | — | — | Not collected |

"Other user-generated content" is the free text a user types: maintenance descriptions, notes,
rejection reasons, announcements.

### Web browsing
**Not collected.** There is no WebView in the app at all.

### App info and performance
**Not collected.** No crash logs, no diagnostics, no performance traces leave the device — verified
against `gradle/libs.versions.toml` and `app/build.gradle.kts`: no Firebase, Crashlytics, AdMob,
Sentry, Bugsnag, AppsFlyer, Mixpanel, Amplitude, Adjust or Facebook SDK. The dependency set is
AndroidX, Compose, Hilt, Room, Coil, Retrofit/OkHttp and `androidx.security.crypto`.

### Device or other IDs
**Not collected.** No advertising ID, no `play-services-ads-identifier`, no SSAID or device
fingerprint is read.

### Location
**Not collected.** No location permission, no location API. Property addresses are typed by the
user, never derived from the device.

### Health and fitness
**Not collected.**

### Messages
**Not collected by the app.** WhatsApp and email messages are composed and dispatched
**server-side**; the Android app neither reads nor sends them and has no SMS or messaging
permission.

### Government ID — **Not collected by the Android app**

This one needs stating carefully, because the *backend* does hold it. `tenants.id_number_ref`
(`supabase/migrations/20260101000028_tenants.sql`) stores a South African ID number as a reference
into `encrypted_secrets`, and the applicant flow accepts an `id_document` ("Copy of ID or
passport"), plus `payslip`, `bank_statement` and `proof_of_address`.

The Android app never touches any of them. `data/tenants/Tenant.kt` mirrors the shared Tenant type
**minus `idNumberRef`**, and says so in its own header comment; `data/leases/Lease.kt` repeats the
reasoning. Grepping the whole Android source for `idNumber`, `id_document` or `passport` returns
only those two comments. There is no rental-application flow in the app. So **Government ID: No** is
the correct Play answer — the declaration covers the app, and the app does not collect it.

Re-check this if a future release adds ID capture or applications to Android. The answer flips the
moment `idNumberRef` enters the Android Tenant model.

---

## Sharing — and why every processor is still "No"

**No data is shared with third parties** in Google's sense. Google's definition excludes transfer to
a "service provider" that processes data on the developer's behalf and on the developer's
instructions. Every third party Proplyst uses is exactly that:

| Processor | Receives | Still "shared = No"? |
|---|---|---|
| **Supabase** | Everything — it is the database, auth and file storage | Yes, infrastructure processor |
| **Render** | Request traffic, server logs, IP addresses | Yes, hosting processor |
| **Google Cloud (Document AI)** | An uploaded document's bytes, when text extraction runs | Yes, processes and returns; does not retain or train |
| **Meta Platforms** | A recipient phone number and message content, where WhatsApp is enabled | Yes, delivery processor — **server-side only** |
| **Resend** | A recipient email address and message content | Yes, delivery processor — **server-side only** |
| **PayFast** | Card and billing details, **entered on the website, never in the app** | Not reached by the app at all |

That is a Play answer, not a POPIA answer. POPIA expects each operator to be *named* to the data
subject, which is why the Privacy Policy lists all of them explicitly.

---

## Data handling practices

- **Encrypted in transit:** Yes, HTTPS everywhere.
- **Deletion:** Users can request deletion in-app and on the web.
- **Data retention:** Accounting records — invoices, payments, expenses and the audit trail — are
  retained for five years to meet South African tax-record obligations, and no longer identify the
  person once the account is deleted. Disclose this exactly; it matches
  `app/api/v1/account/delete/route.ts`, `/delete-account`, the Privacy Policy and Terms §16.

## Security practices on the device

The session token is held in `EncryptedSharedPreferences` (`androidx.security.crypto`), and
`android:allowBackup="false"` keeps it out of Android auto-backup archives, so a token cannot be
restored onto a different device.

---

## Release manifest permissions — the complete list

From the **merged release manifest**, not the source file:

| Permission | Why | Runtime prompt? |
|---|---|---|
| `android.permission.INTERNET` | Talking to the backend | No — normal permission |
| `android.permission.USE_BIOMETRIC` | Optional fingerprint unlock | No — biometric prompt is the consent |
| `android.permission.USE_FINGERPRINT` | Merged in by `androidx.biometric` for pre-API-28 devices | No |

**That is all three.** No `CAMERA`, no `READ_MEDIA_IMAGES`/`READ_EXTERNAL_STORAGE`, no
`ACCESS_*_LOCATION`, no `READ_CONTACTS`, no `RECORD_AUDIO`, no `POST_NOTIFICATIONS`, no `AD_ID`.

The distinction that matters for this form:

- **Direct runtime permission:** none beyond the biometric prompt.
- **System picker / external intent:** photos, files and camera captures all arrive this way. The
  user picks one item in Android's own UI and only that item is handed to the app.
- **Server-side processing:** OCR, WhatsApp and email all happen on the server. The app never
  contacts Google Cloud, Meta or Resend directly.

Because there is no `POST_NOTIFICATIONS` permission, the app shows **no system notifications** —
"Activity" is an in-app feed only.
